#!/usr/bin/env node

/**
 * Demo Trading Bot - Simulates realistic trading for demo videos
 *
 * Creates separate buy bot and sell bot accounts.
 * Both bots trade actively, but with an upward bias so the price
 * gradually drifts from startPrice toward targetPrice.
 * This allows a user's limit sell order to get filled for profit.
 *
 * Usage:
 *   node scripts/demo-trading-bot.js \
 *     --market BTC-PERP \
 *     --start-price 95000 \
 *     --target-price 96000 \
 *     --duration 120 \
 *     --tick-interval 2000 \
 *     --volatility 50
 *
 *   node scripts/demo-trading-bot.js \
 *     --market ETH-PERP \
 *     --start-price 2500 \
 *     --target-price 2600 \
 *     --duration 180 \
 *     --tick-interval 1500 \
 *     --volatility 3
 */

const { createWalletClient, http } = require("viem")
const { privateKeyToAccount } = require("viem/accounts")
const { mainnet } = require("viem/chains")

// ─── Config ────────────────────────────────────────────────────────────────────

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "https://elysia-perp-dev.up.railway.app"
const PERP_USD_ID = 5382
const DEPOSIT_AMOUNT = "1000000000000"

// ─── CLI Args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    market: "BTC-PERP",
    startPrice: 95000,
    targetPrice: 96000,
    duration: 120, // seconds
    tickInterval: 2000, // ms between trades
    volatility: 50, // random noise range (e.g., +/- 50 for BTC)
    minSize: 1,
    maxSize: 5,
    direction: null, // "up" or "down" — auto-detect if null
  }

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const val = args[i + 1]
    switch (key) {
      case "--market":
        config.market = val
        break
      case "--start-price":
        config.startPrice = parseFloat(val)
        break
      case "--target-price":
        config.targetPrice = parseFloat(val)
        break
      case "--duration":
        config.duration = parseInt(val)
        break
      case "--tick-interval":
        config.tickInterval = parseInt(val)
        break
      case "--volatility":
        config.volatility = parseFloat(val)
        break
      case "--min-size":
        config.minSize = parseInt(val)
        break
      case "--max-size":
        config.maxSize = parseInt(val)
        break
      case "--direction":
        config.direction = val // "up" or "down"
        break
    }
  }

  return config
}

// ─── Account Creation ──────────────────────────────────────────────────────────

function getRandomPrivateKey() {
  let pk = "0x"
  for (let j = 0; j < 64; j++) {
    pk += Math.floor(Math.random() * 16).toString(16)
  }
  return pk
}

async function createBotAccount(label) {
  const privateKey = getRandomPrivateKey()
  const client = createWalletClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  })
  const account = privateKeyToAccount(privateKey)

  const nonceRes = await fetch(
    `${API_URL}/auth/nonce?address=${account.address}`
  )
  const nonceData = await nonceRes.json()

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
    throw new Error(`[${label}] Login failed: ${await loginRes.text()}`)
  }

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

  await fetch(`${API_URL}/dev/account/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({ asset_id: PERP_USD_ID, amount: DEPOSIT_AMOUNT }),
  })

  console.log(`[${label}] Account created: ${account.address}`)
  return { cookies, address: account.address }
}

// ─── Order Creation with Token Refresh ─────────────────────────────────────────

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

// ─── Utility ───────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min
}

// Generate a random price with 0.01 precision (e.g., 71488.37)
function randomPrice(min, max) {
  return parseFloat(randomFloat(min, max).toFixed(2))
}

// Generate a natural-looking random size scaled by multiplier
// multiplier=1 → 0.001~5.0, multiplier=10 → 0.01~50.0
function randomSize(multiplier = 1) {
  const r = Math.random()
  let size
  if (r < 0.4) {
    size = randomFloat(0.001, 0.01)
  } else if (r < 0.7) {
    size = randomFloat(0.01, 0.5)
  } else if (r < 0.9) {
    size = randomFloat(0.5, 2.0)
  } else {
    size = randomFloat(2.0, 5.0)
  }
  return parseFloat((size * multiplier).toFixed(5))
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

// Easing function: slow start, slow end — makes price movement look natural
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// ─── Trading Logic ─────────────────────────────────────────────────────────────

// ─── Orderbook Analysis ────────────────────────────────────────────────────────

const MARKET_IDS = { "BTC-PERP": 100, "ETH-PERP": 101 }

async function fetchOrderbook(market) {
  const marketId = MARKET_IDS[market]
  if (!marketId) throw new Error(`Unknown market: ${market}`)
  const res = await fetch(`${API_URL}/orderbook/${marketId}`)
  return res.json()
}

function analyzeDepthToTarget(orderbook, targetPrice, direction) {
  const asks = orderbook.asks || []
  const bids = orderbook.bids || []
  let totalVolume = 0
  let levels = 0

  if (direction === "up") {
    // Need to eat through asks up to targetPrice
    for (const a of asks) {
      const price = parseFloat(a.price)
      const size = parseFloat(a.size)
      if (price <= targetPrice) {
        totalVolume += size
        levels++
      }
    }
  } else {
    // Need to eat through bids down to targetPrice
    for (const b of bids) {
      const price = parseFloat(b.price)
      const size = parseFloat(b.size)
      if (price >= targetPrice) {
        totalVolume += size
        levels++
      }
    }
  }

  const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null
  const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null

  return { totalVolume, levels, bestAsk, bestBid }
}

// ─── Trading Simulation ────────────────────────────────────────────────────────

async function runTradingBot(config) {
  console.log("\n=== Demo Trading Bot ===")
  console.log(`  Market:        ${config.market}`)
  console.log(`  Target Price:  ${config.targetPrice}`)
  console.log(`  Duration:      ${config.duration}s`)
  console.log(`  Tick Interval: ${config.tickInterval}ms`)
  console.log(`  Volatility:    +/- ${config.volatility}`)
  console.log(`  API URL:       ${API_URL}`)
  console.log("")

  // 1. Initial orderbook analysis
  console.log("Analyzing orderbook depth...")
  const initBook = await fetchOrderbook(config.market)

  const initBestBid =
    initBook.bids?.length > 0
      ? parseFloat(initBook.bids[0].price)
      : config.startPrice
  const initBestAsk =
    initBook.asks?.length > 0
      ? parseFloat(initBook.asks[0].price)
      : config.startPrice
  const currentMidPrice = (initBestBid + initBestAsk) / 2

  // Determine direction: use CLI override or auto-detect from best bid
  const direction =
    config.direction || (config.targetPrice > initBestBid ? "up" : "down")
  const initDepth = analyzeDepthToTarget(
    initBook,
    config.targetPrice,
    direction
  )

  console.log(`  Best bid:  ${initDepth.bestBid}`)
  console.log(`  Best ask:  ${initDepth.bestAsk}`)
  console.log(`  Direction: ${direction.toUpperCase()}`)
  console.log(
    `  ${direction === "up" ? "Ask" : "Bid"} volume to clear: ${initDepth.totalVolume.toFixed(2)} (${initDepth.levels} levels)`
  )

  const actualStart =
    direction === "up"
      ? initDepth.bestAsk || config.startPrice
      : initDepth.bestBid || config.startPrice
  const totalTicks = Math.floor((config.duration * 1000) / config.tickInterval)

  console.log(`  Estimated ticks: ${totalTicks}`)
  console.log("")

  // 2. Create bot accounts
  console.log("Creating bot accounts...")
  const [buyBot, sellBot] = await Promise.all([
    createBotAccount("BUY BOT"),
    createBotAccount("SELL BOT"),
  ])

  const buyBotState = { cookies: buyBot.cookies }
  const sellBotState = { cookies: sellBot.cookies }

  // Pause external oracle before starting
  console.log("Pausing external oracle...")
  try {
    await fetch(`${API_URL}/dev/oracle/pause`, { method: "POST" })
    console.log(
      "  Oracle paused — bot will control price via /dev/oracle/price\n"
    )
  } catch (err) {
    console.warn(`  Failed to pause oracle: ${err.message}\n`)
  }

  console.log("Starting trading simulation...\n")

  const startTime = Date.now()
  const endTime = startTime + config.duration * 1000
  let tickCount = 0
  let lastPrice = actualStart
  let lastDepthCheck = {
    totalVolume: initDepth.totalVolume,
    bestAsk: initDepth.bestAsk,
    bestBid: initDepth.bestBid,
  }

  // Oracle price update every 500ms
  const oracleInterval = setInterval(async () => {
    try {
      await fetch(`${API_URL}/dev/oracle/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: config.market,
          price: parseFloat(lastPrice.toFixed(2)),
        }),
      })
    } catch (err) {
      console.warn(`  [ORACLE] update failed: ${err.message}`)
    }
  }, 500)

  const interval = setInterval(async () => {
    const now = Date.now()
    if (now >= endTime) {
      clearInterval(interval)
      clearInterval(oracleInterval)
      console.log("\n=== Trading simulation complete ===")
      console.log(`  Direction: ${direction.toUpperCase()}`)
      console.log(`  Final price: ~${lastPrice.toFixed(2)}`)
      console.log(`  Total ticks: ${tickCount}\n`)
      process.exit(0)
      return
    }

    tickCount++
    const elapsed = (now - startTime) / 1000
    const progress = Math.min(elapsed / config.duration, 1)

    try {
      // ── Every 5 ticks: re-fetch orderbook to check remaining depth
      if (tickCount % 5 === 1) {
        const liveBook = await fetchOrderbook(config.market)
        lastDepthCheck = analyzeDepthToTarget(
          liveBook,
          config.targetPrice,
          direction
        )
        const remainingTicks = Math.max(1, totalTicks - tickCount)
        const aggressiveTicksLeft = Math.max(
          1,
          Math.floor(remainingTicks * 0.35)
        )
        lastDepthCheck.avgSize = Math.max(
          config.maxSize,
          Math.ceil(lastDepthCheck.totalVolume / aggressiveTicksLeft) + 1
        )

        const edgePrice =
          direction === "up" ? lastDepthCheck.bestAsk : lastDepthCheck.bestBid
        console.log(
          `  [DEPTH] remaining: ${lastDepthCheck.totalVolume.toFixed(2)} | best ${direction === "up" ? "ask" : "bid"}: ${edgePrice} | size/tick: ~${lastDepthCheck.avgSize}`
        )
      }

      const avgSize = lastDepthCheck.avgSize || config.maxSize
      const currentBestAsk = lastDepthCheck.bestAsk || lastPrice
      const currentBestBid = lastDepthCheck.bestBid || lastPrice

      // Calculate target mid with easing
      const easedProgress = easeInOut(progress)
      const targetMid = lerp(actualStart, config.targetPrice, easedProgress)
      // Bias noise in the direction of movement
      const noise =
        direction === "up"
          ? randomFloat(-config.volatility, config.volatility * 0.6)
          : randomFloat(-config.volatility * 0.6, config.volatility)
      const currentMid = parseFloat((targetMid + noise).toFixed(2))
      lastPrice = currentMid

      // ── Tight walls: bid and ask within $1 of mid
      const wallSpread = randomFloat(0.1, 0.5)

      const action = Math.random()

      if (direction === "up") {
        // ════════════════════════════════════════════════════
        // UPWARD: aggressive buy, gentle sell
        // ════════════════════════════════════════════════════
        if (action < 0.3) {
          const size = randomSize(avgSize)
          const bidPrice = randomPrice(
            Math.max(currentMid, currentBestAsk),
            Math.max(currentMid, currentBestAsk) + 1.0
          )
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "LONG",
            bidPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.42) {
          const wallSize = randomSize(avgSize * 0.6)
          const wallPrice = randomPrice(
            currentMid - wallSpread - 0.3,
            currentMid - wallSpread
          )
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            wallPrice,
            wallSize
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "wall",
            wallPrice,
            wallSize,
            result,
            progress
          )
        } else if (action < 0.54) {
          const wallSize = randomSize(avgSize * 0.6)
          const wallPrice = randomPrice(
            currentMid + wallSpread,
            currentMid + wallSpread + 0.3
          )
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            wallPrice,
            wallSize
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "wall",
            wallPrice,
            wallSize,
            result,
            progress
          )
        } else if (action < 0.66) {
          const size = randomSize(avgSize * 0.3)
          const bidPrice = randomPrice(currentMid - 0.8, currentMid - 0.1)
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "long",
            bidPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.78) {
          const size = randomSize(avgSize * 0.3)
          const askPrice = randomPrice(currentMid + 0.1, currentMid + 0.8)
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "short",
            askPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.88) {
          const size = randomSize(avgSize * 0.15)
          const askPrice = randomPrice(currentMid - 0.3, currentMid)
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "SHORT",
            askPrice,
            size,
            result,
            progress
          )
        } else {
          const size = randomSize(avgSize * 0.5)
          const bidPrice = randomPrice(currentMid, currentMid + 0.5)
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "LONG",
            bidPrice,
            size,
            result,
            progress
          )
        }
      } else {
        // ════════════════════════════════════════════════════
        // DOWNWARD: aggressive sell + dense orderbook building
        // ════════════════════════════════════════════════════
        if (action < 0.2) {
          // Aggressive sell: eat through bids toward target
          const size = randomSize(avgSize)
          const askPrice = randomPrice(
            Math.min(currentMid, currentBestBid) - 1.0,
            Math.min(currentMid, currentBestBid)
          )
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "SHORT",
            askPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.32) {
          // Extra aggressive sell
          const size = randomSize(avgSize * 0.5)
          const askPrice = randomPrice(currentMid - 0.5, currentMid)
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "SHORT",
            askPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.42) {
          // Passive sell near mid
          const size = randomSize(avgSize * 0.3)
          const askPrice = randomPrice(currentMid + 0.05, currentMid + 0.5)
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "SELL BOT",
            "short",
            askPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.52) {
          // Passive buy near mid
          const size = randomSize(avgSize * 0.3)
          const bidPrice = randomPrice(currentMid - 0.5, currentMid - 0.05)
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "long",
            bidPrice,
            size,
            result,
            progress
          )
        } else if (action < 0.6) {
          // Counter buy (small)
          const size = randomSize(avgSize * 0.15)
          const bidPrice = randomPrice(currentMid, currentMid + 0.3)
          const result = await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidPrice,
            size
          )
          logTick(
            tickCount,
            elapsed,
            "BUY BOT",
            "LONG",
            bidPrice,
            size,
            result,
            progress
          )
        } else {
          // Spread fill: matched bid+ask pair
          const fillWallSize = randomSize(avgSize * 0.3)
          const bidFill = randomPrice(currentMid - 0.3, currentMid - 0.05)
          const askFill = randomPrice(currentMid + 0.05, currentMid + 0.3)
          await createOrder(
            buyBotState,
            config.market,
            "Long",
            bidFill,
            fillWallSize
          )
          const result = await createOrder(
            sellBotState,
            config.market,
            "Short",
            askFill,
            fillWallSize
          )
          logTick(
            tickCount,
            elapsed,
            "BOTH",
            "fill",
            currentMid,
            fillWallSize,
            result,
            progress
          )
        }
      }

      // ── Every tick: build dense orderbook around current price
      // Tight fills right around mid (±$0.5)
      const fillCount = randomInt(3, 5)
      for (let f = 0; f < fillCount; f++) {
        const bidFillSize = randomSize(
          direction === "up" ? avgSize * 0.3 : avgSize * 0.1
        )
        const askFillSize = randomSize(
          direction === "up" ? avgSize * 0.1 : avgSize * 0.3
        )
        const offset = randomFloat(0.01, 0.3)
        const bidP = randomPrice(
          currentMid - offset - randomFloat(0.01, 0.05),
          currentMid - offset
        )
        const askP = randomPrice(
          currentMid + offset,
          currentMid + offset + randomFloat(0.01, 0.05)
        )

        await createOrder(buyBotState, config.market, "Long", bidP, bidFillSize)
        await createOrder(
          sellBotState,
          config.market,
          "Short",
          askP,
          askFillSize
        )
      }

      // Spread the book further out (±$1~$3) to fill gaps
      const spreadCount = randomInt(2, 4)
      for (let s = 0; s < spreadCount; s++) {
        const bidSpreadSize = randomSize(
          direction === "up" ? avgSize * 0.4 : avgSize * 0.15
        )
        const askSpreadSize = randomSize(
          direction === "up" ? avgSize * 0.15 : avgSize * 0.4
        )
        const farOffset = randomFloat(0.5, 3.0)
        const bidP = randomPrice(
          currentMid - farOffset - randomFloat(0.01, 0.1),
          currentMid - farOffset
        )
        const askP = randomPrice(
          currentMid + farOffset,
          currentMid + farOffset + randomFloat(0.01, 0.1)
        )

        await createOrder(
          buyBotState,
          config.market,
          "Long",
          bidP,
          bidSpreadSize
        )
        await createOrder(
          sellBotState,
          config.market,
          "Short",
          askP,
          askSpreadSize
        )
      }

      // ── Every tick (UP only): build thick buy walls below current price
      if (direction === "up") {
        // Close buy walls (support near spread)
        const closeWallCount = randomInt(3, 5)
        for (let w = 0; w < closeWallCount; w++) {
          const wallSize = randomSize(avgSize * 1.5)
          const depth = randomFloat(0.1, 2.0)
          const wallPrice = randomPrice(
            currentMid - depth - 0.1,
            currentMid - depth
          )
          await createOrder(
            buyBotState,
            config.market,
            "Long",
            wallPrice,
            wallSize
          )
        }
        // Deep buy walls (further support)
        const deepWallCount = randomInt(2, 3)
        for (let w = 0; w < deepWallCount; w++) {
          const wallSize = randomSize(avgSize * 2.0)
          const depth = randomFloat(2.0, 8.0)
          const wallPrice = randomPrice(
            currentMid - depth - 0.5,
            currentMid - depth
          )
          await createOrder(
            buyBotState,
            config.market,
            "Long",
            wallPrice,
            wallSize
          )
        }
      }

      // ── Every 3 ticks: walls close to mid (UP: heavier bid walls)
      if (tickCount % 3 === 0) {
        const bidWallSize = randomSize(
          direction === "up" ? avgSize * 1.0 : avgSize * 0.4
        )
        const askWallSize = randomSize(
          direction === "up" ? avgSize * 0.2 : avgSize * 0.4
        )
        const bidWallP = randomPrice(currentMid - 0.3, currentMid - 0.05)
        const askWallP = randomPrice(currentMid + 0.05, currentMid + 0.3)

        await createOrder(
          buyBotState,
          config.market,
          "Long",
          bidWallP,
          bidWallSize
        )
        await createOrder(
          sellBotState,
          config.market,
          "Short",
          askWallP,
          askWallSize
        )

        console.log(
          `  [WALLS] bid ${wallSize.toFixed(5)} @ ${bidWallP.toFixed(2)} | ask ${wallSize.toFixed(5)} @ ${askWallP.toFixed(2)}`
        )
      }
    } catch (err) {
      console.error(`  [ERROR] tick ${tickCount}: ${err.message}`)
    }
  }, config.tickInterval)
}

function logTick(tick, elapsed, bot, sideLabel, price, size, result, progress) {
  const pct = (progress * 100).toFixed(1)
  const status = result.success ? "OK" : "FAIL"
  const elapsedStr = elapsed.toFixed(1).padStart(6)
  const sizeStr = typeof size === "number" ? size.toFixed(5) : size
  const priceStr = typeof price === "number" ? price.toFixed(2) : price
  console.log(
    `[${elapsedStr}s | ${pct}%] #${tick} ${bot} ${sideLabel.padEnd(5)} ${sizeStr.padStart(10)} @ ${priceStr}  ${status}`
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const config = parseArgs()
runTradingBot(config).catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
