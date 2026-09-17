#!/usr/bin/env node

/**
 * Demo Orderbook Setup Script
 *
 * Fetches real orderbook data from Binance and places it on the Elysia Perp system.
 * Uses the same API pattern as api/trade-bot (create-account, create-order).
 *
 * Usage:
 *   node scripts/demo-setup-orderbook.js --market BTC-PERP --levels 30 --price-unit 100
 *   node scripts/demo-setup-orderbook.js --market ETH-PERP --levels 30 --price-unit 1
 */

const { createWalletClient, http } = require("viem")
const { privateKeyToAccount } = require("viem/accounts")
const { mainnet } = require("viem/chains")
const https = require("https")

// ─── Config ────────────────────────────────────────────────────────────────────

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://elysia-perp-dev.up.railway.app"
const PERP_USD_ID = 5382
const DEPOSIT_AMOUNT = "1000000000000"

const BINANCE_API = "https://api.binance.com/api/v3"

// market name → Binance symbol mapping
const MARKET_TO_SYMBOL = {
  "BTC-PERP": "BTCUSDT",
  "ETH-PERP": "ETHUSDT",
}

// ─── CLI Args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    market: "BTC-PERP",
    levels: 50, // how many raw price levels per side to use
    binanceLimit: 5000, // depth limit from Binance
  }

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const val = args[i + 1]
    switch (key) {
      case "--market":
        config.market = val
        break
      case "--levels":
        config.levels = parseInt(val)
        break
      case "--binance-limit":
        config.binanceLimit = parseInt(val)
        break
    }
  }

  return config
}

// ─── Binance Orderbook Fetch ───────────────────────────────────────────────────

function fetchBinanceOrderbook(symbol, limit) {
  return new Promise((resolve, reject) => {
    const url = `${BINANCE_API}/depth?symbol=${symbol}&limit=${limit}`
    https
      .get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => {
          data += chunk
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error(`Failed to parse Binance response: ${e.message}`))
          }
        })
      })
      .on("error", reject)
  })
}

/**
 * Parse raw Binance orderbook entries into { price, size } objects.
 * Keeps the original 0.01 precision — no aggregation.
 */
function parseRawEntries(entries) {
  return entries
    .map(([priceStr, qtyStr]) => ({
      price: parseFloat(priceStr),
      size: parseFloat(qtyStr),
    }))
    .filter((e) => e.price > 0 && e.size > 0)
}

/**
 * Spread out price levels with random gaps (0.01 ~ 0.09) from a starting price.
 * Makes the orderbook look organic instead of uniform Binance tick spacing.
 *
 * @param {Array} entries - sorted entries (bids desc, asks asc)
 * @param {"bid"|"ask"} side - determines direction of price walk
 * @param {number} count - how many levels to generate
 */
function randomizeSpacing(entries, side, count) {
  if (entries.length === 0) return []

  const result = []
  // Start from the best bid/ask price
  let currentPrice = entries[0].price

  // Collect sizes from original entries, with some random variation
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    // Randomize size: take original and add jitter (+/- 30%)
    const origSize = entries[i].size
    const sizeJitter = 0.7 + Math.random() * 0.6 // 0.7 ~ 1.3
    const size = parseFloat((origSize * sizeJitter).toFixed(5))

    result.push({ price: parseFloat(currentPrice.toFixed(2)), size })

    // Random gap: pick from irregular steps like 0.01, 0.02, 0.03, 0.05, 0.07, 0.08
    const gaps = [
      0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.05, 0.05, 0.06, 0.07, 0.08,
      0.09,
    ]
    const gap = gaps[Math.floor(Math.random() * gaps.length)]

    if (side === "bid") {
      currentPrice -= gap
    } else {
      currentPrice += gap
    }
  }

  return result
}

// ─── Account Creation (same pattern as api/trade-bot/create-account) ───────────

function getRandomPrivateKey() {
  let pk = "0x"
  for (let j = 0; j < 64; j++) {
    pk += Math.floor(Math.random() * 16).toString(16)
  }
  return pk
}

async function createBotAccount() {
  const privateKey = getRandomPrivateKey()
  const client = createWalletClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  })
  const account = privateKeyToAccount(privateKey)

  // 1. Get nonce
  const nonceRes = await fetch(
    `${API_URL}/auth/nonce?address=${account.address}`
  )
  const nonceData = await nonceRes.json()

  // 2. Sign EIP712
  const signature = await client.signTypedData({
    account,
    domain: {
      name: "ELSIA_PERP",
      version: "1",
      chainId: BigInt(11155111),
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      LoginMessage: [
        { name: "user", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "LoginMessage",
    message: { user: account.address, nonce: nonceData.nonce },
  })

  // 3. Login
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      signature,
      nonce: nonceData.nonce,
    }),
  })

  if (!loginRes.ok) {
    throw new Error(`Login failed: ${await loginRes.text()}`)
  }

  // 4. Extract cookies
  const setCookieHeaders = loginRes.headers.getSetCookie?.() || []
  let cookies = ""
  if (setCookieHeaders.length > 0) {
    cookies = setCookieHeaders.map((c) => c.split(";")[0]).join("; ")
  } else {
    const sc = loginRes.headers.get("set-cookie")
    if (sc) {
      cookies = (Array.isArray(sc) ? sc : [sc])
        .map((c) => c.split(";")[0])
        .join("; ")
    }
  }

  // 5. Deposit PERP_USD
  await fetch(`${API_URL}/dev/account/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({ asset_id: PERP_USD_ID, amount: DEPOSIT_AMOUNT }),
  })

  console.log(`Account created: ${account.address}`)
  return { cookies, address: account.address }
}

// ─── Order Creation (same pattern as api/trade-bot/create-order) ───────────────

async function createOrder(botState, market, side, price, size, leverage = 10) {
  const doRequest = async (cookies) => {
    return fetch(`${API_URL}/perp/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({
        market,
        side,
        is_ask: side === "Short" || side === "sell",
        price: price.toString(),
        size: size.toString(),
        base_amount: size.toString(),
        leverage,
      }),
    })
  }

  let res = await doRequest(botState.cookies)

  if (!res.ok) {
    const errText = await res.text()
    let errBody
    try {
      errBody = JSON.parse(errText)
    } catch {
      errBody = { error: errText }
    }

    // Handle token expiry
    if (res.status === 401 || errBody.code === "ACCESS_TOKEN_EXPIRED") {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: botState.cookies,
        },
      })
      if (refreshRes.ok) {
        const newHeaders = refreshRes.headers.getSetCookie?.() || []
        if (newHeaders.length > 0) {
          botState.cookies = newHeaders.map((c) => c.split(";")[0]).join("; ")
        }
        res = await doRequest(botState.cookies)
        if (res.ok) {
          return { success: true, data: await res.json() }
        }
      }
      return { success: false, error: "Token refresh failed" }
    }

    return { success: false, error: errBody.error || errText }
  }

  return { success: true, data: await res.json() }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs()
  const binanceSymbol = MARKET_TO_SYMBOL[config.market]

  if (!binanceSymbol) {
    console.error(
      `Unknown market: ${config.market}. Supported: ${Object.keys(MARKET_TO_SYMBOL).join(", ")}`
    )
    process.exit(1)
  }

  console.log("\n=== Demo Orderbook Setup (Binance Raw Data) ===")
  console.log(`  Market:        ${config.market}`)
  console.log(`  Binance:       ${binanceSymbol}`)
  console.log(`  Levels:        ${config.levels} per side`)
  console.log(`  Binance Limit: ${config.binanceLimit}`)
  console.log(`  API URL:       ${API_URL}`)
  console.log("")

  // 1. Fetch real orderbook from Binance
  console.log(`Fetching orderbook from Binance (${binanceSymbol})...`)
  const binanceBook = await fetchBinanceOrderbook(
    binanceSymbol,
    config.binanceLimit
  )

  const rawBids = binanceBook.bids || []
  const rawAsks = binanceBook.asks || []
  console.log(`  Raw entries: ${rawBids.length} bids, ${rawAsks.length} asks`)

  // 2. Parse raw entries, then randomize spacing for natural-looking gaps
  const rawBidsParsed = parseRawEntries(rawBids).sort(
    (a, b) => b.price - a.price
  ) // descending (highest bid first)

  const rawAsksParsed = parseRawEntries(rawAsks).sort(
    (a, b) => a.price - b.price
  ) // ascending (lowest ask first)

  const bids = randomizeSpacing(rawBidsParsed, "bid", config.levels)
  const asks = randomizeSpacing(rawAsksParsed, "ask", config.levels)

  const midPrice =
    bids.length && asks.length
      ? ((bids[0].price + asks[0].price) / 2).toFixed(2)
      : "N/A"

  console.log(`  Using: ${bids.length} bid levels, ${asks.length} ask levels`)
  console.log(`  Mid price: ~${midPrice}`)
  console.log("")

  // Show orderbook preview (top 10 each side)
  console.log("─── ASKS (lowest first) ───")
  ;[...asks]
    .slice(0, 10)
    .reverse()
    .forEach((o) => {
      console.log(
        `  ${o.price.toFixed(2).padStart(12)}  |  ${o.size.toFixed(5)}`
      )
    })
  console.log("─── MID ───────────────────")
  bids.slice(0, 10).forEach((o) => {
    console.log(`  ${o.price.toFixed(2).padStart(12)}  |  ${o.size.toFixed(5)}`)
  })
  console.log(`─── (${bids.length + asks.length} levels total) ──`)
  console.log("")

  // 3. Create bot account
  console.log("Creating bot account...")
  const botState = await createBotAccount()

  // 4. Place all orders — price & size as-is from Binance (decimal)
  const allOrders = [
    ...bids.map((o) => ({ ...o, side: "Long" })),
    ...asks.map((o) => ({ ...o, side: "Short" })),
  ]

  console.log(`\nPlacing ${allOrders.length} orders...\n`)

  let success = 0
  let fail = 0

  for (const order of allOrders) {
    const result = await createOrder(
      botState,
      config.market,
      order.side,
      order.price,
      order.size
    )

    if (result.success) {
      console.log(
        `  ${order.side.padEnd(5)} ${order.size.toFixed(5).padStart(10)} @ ${order.price.toFixed(2)}`
      )
      success++
    } else {
      console.error(
        `  FAIL ${order.side} ${order.size.toFixed(5)} @ ${order.price.toFixed(2)}: ${result.error}`
      )
      fail++
    }

    await new Promise((r) => setTimeout(r, 50))
  }

  console.log(`\n=== Done ===`)
  console.log(`  Success: ${success}`)
  console.log(`  Failed:  ${fail}`)
  console.log(`  Total:   ${allOrders.length}`)
  console.log(`  Mid:     ~${midPrice}\n`)
}

main().catch(console.error)
