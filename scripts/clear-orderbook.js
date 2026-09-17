#!/usr/bin/env node

/**
 * Clear Orderbook - Sweeps all existing orders by placing massive
 * market-crossing orders on both sides.
 *
 * Usage:
 *   node scripts/clear-orderbook.js
 *   node scripts/clear-orderbook.js --market ETH-PERP
 */

const { privateKeyToAccount } = require("viem/accounts")
const fs = require("fs")
const path = require("path")

// ── Load .env ──
try {
  const envContent = fs.readFileSync(
    path.resolve(__dirname, "../.env"),
    "utf-8"
  )
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
} catch {}

const API_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001"

const ADMIN_SECRET = process.env.ADMIN_SECRET || ""
const PERP_USD_ID = 5382
const DEPOSIT_AMOUNT = "10000000000"

const MARKET_IDS = { "BTC-PERP": 100, "ETH-PERP": 101 }

// ─── CLI Args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const config = { market: "BTC-PERP" }

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const val = args[i + 1]
    if (key === "--market") config.market = val
  }

  return config
}

// ─── Account Creation (local signing, no RPC) ─────────────────────────────────

function getRandomPrivateKey() {
  let pk = "0x"
  for (let j = 0; j < 64; j++) {
    pk += Math.floor(Math.random() * 16).toString(16)
  }
  return pk
}

async function createBotAccount(label) {
  const privateKey = getRandomPrivateKey()
  const account = privateKeyToAccount(privateKey)

  // 1. Get nonce
  const nonceRes = await fetch(
    `${API_URL}/auth/nonce?address=${account.address}`
  )
  const { nonce } = await nonceRes.json()

  // 2. Sign EIP-712 (local)
  const signature = await account.signTypedData({
    domain: {
      name: "ELSIA_PERP",
      version: "1",
      chainId: BigInt(11155111),
    },
    types: {
      LoginMessage: [
        { name: "user", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "LoginMessage",
    message: { user: account.address, nonce },
  })

  // 3. Login
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address, signature, nonce }),
  })

  if (!loginRes.ok) {
    throw new Error(`[${label}] Login failed: ${await loginRes.text()}`)
  }

  // 4. Extract cookies
  const setCookieHeaders = loginRes.headers.getSetCookie?.() || []
  let cookies = ""
  if (setCookieHeaders.length > 0) {
    cookies = setCookieHeaders.map((c) => c.split(";")[0]).join("; ")
  } else {
    const header = loginRes.headers.get("set-cookie")
    if (header) {
      cookies = (Array.isArray(header) ? header : [header])
        .map((c) => c.split(";")[0])
        .join("; ")
    }
  }

  // 5. Deposit
  const depositRes = await fetch(`${API_URL}/dev/account/deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
      "X-Api-Key": ADMIN_SECRET,
    },
    body: JSON.stringify({ asset_id: PERP_USD_ID, amount: DEPOSIT_AMOUNT }),
  })

  if (!depositRes.ok) {
    const errText = await depositRes.text()
    throw new Error(
      `[${label}] Deposit failed: ${depositRes.status} ${errText}`
    )
  }

  console.log(`[${label}] Account created: ${account.address}`)
  return { cookies, account, label }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function cancelAllOrders(cookies, market) {
  try {
    await fetch(`${API_URL}/perp/orders`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ market }),
    })
  } catch {
    // ignore
  }
}

async function sweepOnce(config, marketId) {
  const bookRes = await fetch(`${API_URL}/orderbook/${marketId}`)
  const book = await bookRes.json()
  const asks = book.asks || []
  const bids = book.bids || []

  if (asks.length === 0 && bids.length === 0)
    return { done: true, asks: 0, bids: 0 }

  let totalAskSize = 0
  let highestAsk = 0
  for (const ask of asks) {
    totalAskSize += parseFloat(ask.size)
    highestAsk = Math.max(highestAsk, parseFloat(ask.price))
  }

  let totalBidSize = 0
  for (const bid of bids) {
    totalBidSize += parseFloat(bid.size)
  }

  console.log(
    `  Asks: ${asks.length} levels (${totalAskSize.toFixed(6)}) | Bids: ${bids.length} levels (${totalBidSize.toFixed(6)})`
  )

  // Create fresh accounts per sweep (avoids position conflicts)
  const [buyBot, sellBot] = await Promise.all([
    createBotAccount("SWEEP-BUY"),
    createBotAccount("SWEEP-SELL"),
  ])

  // Sweep asks (buy at very high price)
  if (totalAskSize > 0) {
    const sweepPrice = Math.ceil(highestAsk) + 1000
    const size = totalAskSize.toFixed(6)
    console.log(`  BUY ${size} @ ${sweepPrice}...`)
    const res = await fetch(`${API_URL}/perp/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: buyBot.cookies,
      },
      body: JSON.stringify({
        market: config.market,
        side: "Long",
        is_ask: false,
        price: sweepPrice.toString(),
        size,
        base_amount: size,
        leverage: "1",
      }),
    })
    const data = await res.json()
    console.log(
      `    ${res.ok ? "OK" : "FAIL"}: ${data.status || data.error || JSON.stringify(data)}`
    )
    await cancelAllOrders(buyBot.cookies, config.market)
  }

  // Sweep bids (sell at very low price)
  if (totalBidSize > 0) {
    const size = totalBidSize.toFixed(6)
    console.log(`  SELL ${size} @ 1...`)
    const res = await fetch(`${API_URL}/perp/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sellBot.cookies,
      },
      body: JSON.stringify({
        market: config.market,
        side: "Short",
        is_ask: true,
        price: "1",
        size,
        base_amount: size,
        leverage: "1",
      }),
    })
    const data = await res.json()
    console.log(
      `    ${res.ok ? "OK" : "FAIL"}: ${data.status || data.error || JSON.stringify(data)}`
    )
    await cancelAllOrders(sellBot.cookies, config.market)
  }

  await new Promise((r) => setTimeout(r, 500))

  // Check remaining
  const afterRes = await fetch(`${API_URL}/orderbook/${marketId}`)
  const after = await afterRes.json()
  const remainAsks = after.asks?.length || 0
  const remainBids = after.bids?.length || 0

  return {
    done: remainAsks === 0 && remainBids === 0,
    asks: remainAsks,
    bids: remainBids,
  }
}

async function main() {
  const config = parseArgs()
  const marketId = MARKET_IDS[config.market]
  if (!marketId) {
    console.error(`Unknown market: ${config.market}`)
    process.exit(1)
  }

  console.log("\n=== Clear Orderbook ===")
  console.log(`  Market:  ${config.market}`)
  console.log(`  API URL: ${API_URL}`)
  console.log("")

  const maxRounds = 20

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`── Round ${round} ──`)
    const result = await sweepOnce(config, marketId)

    if (result.done) {
      console.log("\nOrderbook cleared successfully!")
      return
    }

    console.log(`  Remaining: ${result.asks} asks, ${result.bids} bids\n`)
  }

  console.log(
    `\nWarning: orderbook not fully cleared after ${maxRounds} rounds`
  )
}

main().catch((err) => {
  console.error("Fatal:", err.message || err)
  process.exit(1)
})
