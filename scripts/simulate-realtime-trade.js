// Place Order based on binance trades (Perp API)

const WebSocket = require("ws")
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

// Binance WebSocket endpoint (Spot)
const WS_URL = "wss://stream.binance.com:9443/ws/"

// Markets to subscribe to
const MARKETS = ["btcusdt"]

// Perp Market ID mapping
const MARKET_IDS = {
  btcusdt: 100,
  ethusdt: 101,
}

const MARKET_NAMES = {
  btcusdt: "BTC-PERP",
  ethusdt: "ETH-PERP",
}

const API_URL =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001"

const ADMIN_SECRET = process.env.ADMIN_SECRET || ""

console.log("API_URL", API_URL)

const PERP_USD_ID = 5382
const DEPOSIT_AMOUNT = "1000000000000"

// Store authenticated accounts (buyer + seller)
let buyerAccount = null
let sellerAccount = null

// Per-account refresh promise
const refreshPromises = new Map()

function getRandomPrivateKey() {
  let pk = "0x"
  for (let j = 0; j < 64; j++) {
    pk += Math.floor(Math.random() * 16).toString(16)
  }
  return pk
}

// Create and authenticate account, then deposit (로컬 서명 — RPC 불필요)
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

// Re-login: create new session when refresh token is also expired
async function reLogin(botAccount) {
  try {
    const account = botAccount.account

    // 1. Get nonce
    const nonceRes = await fetch(
      `${API_URL}/auth/nonce?address=${account.address}`
    )
    const { nonce } = await nonceRes.json()

    // 2. Sign
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
      return { success: false, error: `Re-login failed: ${loginRes.status}` }
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

    console.log(`[${botAccount.label}] Re-login successful`)
    return { success: true, cookies }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// Refresh token (per-account, with re-login fallback)
async function refreshToken(botAccount) {
  const key = botAccount.label
  if (refreshPromises.has(key)) return refreshPromises.get(key)

  const promise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: botAccount.cookies,
        },
      })

      if (res.ok) {
        const setCookieHeaders = res.headers.getSetCookie?.() || []
        let newCookies = ""
        if (setCookieHeaders.length > 0) {
          newCookies = setCookieHeaders.map((c) => c.split(";")[0]).join("; ")
        } else {
          const header = res.headers.get("set-cookie")
          if (header) {
            newCookies = (Array.isArray(header) ? header : [header])
              .map((c) => c.split(";")[0])
              .join("; ")
          }
        }
        return { success: true, cookies: newCookies || botAccount.cookies }
      }

      // Refresh failed — try re-login
      console.log(`[${botAccount.label}] Refresh failed, re-logging in...`)
      return await reLogin(botAccount)
    } catch (e) {
      // Network error — try re-login
      console.log(`[${botAccount.label}] Refresh error, re-logging in...`)
      return await reLogin(botAccount)
    } finally {
      refreshPromises.delete(key)
    }
  })()

  refreshPromises.set(key, promise)
  return promise
}

// Create a single order via /perp/order
async function createOrder(market, order, botAccount) {
  const orderUrl = `${API_URL}/perp/order`
  const isAsk =
    order.side === "Short" || order.side === "sell" || order.side === "ask"

  try {
    let res = await fetch(orderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: botAccount.cookies,
      },
      body: JSON.stringify({
        market: MARKET_NAMES[market] || market,
        side: isAsk ? "Short" : "Long",
        is_ask: isAsk,
        price: order.price.toString(),
        size: order.size.toString(),
        base_amount: order.size.toString(),
        leverage: "1",
      }),
    })

    // Handle token expired
    if (res.status === 401) {
      console.log(`[${botAccount.label}] Token expired, refreshing...`)
      const refreshResult = await refreshToken(botAccount)
      if (refreshResult.success) {
        botAccount.cookies = refreshResult.cookies
        res = await fetch(orderUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: botAccount.cookies,
          },
          body: JSON.stringify({
            market: MARKET_NAMES[market] || market,
            side: isAsk ? "Short" : "Long",
            is_ask: isAsk,
            price: order.price.toString(),
            size: order.size.toString(),
            base_amount: order.size.toString(),
            leverage: "1",
          }),
        })
      } else {
        console.error(
          `[${botAccount.label}] Refresh failed: ${refreshResult.error}`
        )
        return { success: false }
      }
    }

    if (res.ok) {
      const data = await res.json()
      const sideLabel = isAsk ? "SHORT" : "LONG"
      console.log(
        `✓ [${botAccount.label}] ${sideLabel} ${order.size} @ ${order.price} (order_id: ${data.order_id})`
      )
      return { success: true, orderData: data }
    } else {
      const errorText = await res.text()
      console.error(
        `✗ [${botAccount.label}] ${order.size} @ ${order.price} - ${res.status}: ${errorText}`
      )
      return { success: false, error: errorText }
    }
  } catch (err) {
    console.error(`✗ [${botAccount.label}] Error: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ── Main ──
async function main() {
  console.log("=== Simulate Realtime Trade (Perp) ===")
  console.log(`API: ${API_URL}`)
  console.log(`Markets: ${MARKETS.map((m) => m.toUpperCase()).join(", ")}`)
  console.log()

  // Create buyer + seller accounts
  console.log("Creating bot accounts...")
  buyerAccount = await createBotAccount("BUYER")
  sellerAccount = await createBotAccount("SELLER")
  console.log()

  // Subscribe to Binance trade streams
  MARKETS.forEach((market) => {
    const ws = new WebSocket(`${WS_URL}${market}@trade`)

    // Accumulate trades for 1 second, then send one order per side
    let buyAccum = { size: 0, priceSum: 0, count: 0 }
    let sellAccum = { size: 0, priceSum: 0, count: 0 }
    let flushTimer = null

    const flushOrders = async () => {
      flushTimer = null
      const buySnap = { ...buyAccum }
      const sellSnap = { ...sellAccum }
      buyAccum = { size: 0, priceSum: 0, count: 0 }
      sellAccum = { size: 0, priceSum: 0, count: 0 }

      if (buySnap.size > 0) {
        const avgPrice = (buySnap.priceSum / buySnap.count).toFixed(2)
        const size = buySnap.size.toFixed(5)
        console.log(
          `\n[${market.toUpperCase()}] LONG ${size} @ ${avgPrice} (${buySnap.count} trades)`
        )
        await createOrder(
          market,
          { side: "Long", price: avgPrice, size },
          buyerAccount
        ).catch((err) => console.error(`Error sending buy order:`, err.message))
      }

      if (sellSnap.size > 0) {
        const avgPrice = (sellSnap.priceSum / sellSnap.count).toFixed(2)
        const size = sellSnap.size.toFixed(5)
        console.log(
          `\n[${market.toUpperCase()}] SHORT ${size} @ ${avgPrice} (${sellSnap.count} trades)`
        )
        await createOrder(
          market,
          { side: "Short", price: avgPrice, size },
          sellerAccount
        ).catch((err) =>
          console.error(`Error sending sell order:`, err.message)
        )
      }
    }

    ws.on("open", () => {
      console.log(`Connected to Binance Trade Stream: ${market.toUpperCase()}`)
    })

    ws.on("message", (data) => {
      try {
        const trade = JSON.parse(data.toString())
        if (trade.e !== "trade") return

        const price = parseFloat(trade.p)
        const quantity = parseFloat(trade.q) * 50

        if (price <= 0 || quantity <= 0) return
        if (quantity < 0.0001) return

        const isBuyer = Math.random() < 0.5
        const priceOffset = Math.random() < 0.5 ? (isBuyer ? -1 : 1) : 0
        const adjustedPrice = price + priceOffset

        if (isBuyer) {
          buyAccum.size += quantity
          buyAccum.priceSum += adjustedPrice
          buyAccum.count++
        } else {
          sellAccum.size += quantity
          sellAccum.priceSum += adjustedPrice
          sellAccum.count++
        }

        // Schedule flush after 1 second of first trade in batch
        if (!flushTimer) {
          flushTimer = setTimeout(flushOrders, 1000)
        }
      } catch (err) {
        console.error(`Error processing ${market} trade:`, err.message)
      }
    })

    ws.on("error", (err) => {
      console.error(`WebSocket error for ${market}:`, err.message)
    })

    ws.on("close", () => {
      console.log(`Disconnected from ${market.toUpperCase()} Trade Stream`)
    })
  })

  console.log("\nWaiting for Binance trades...\n")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
