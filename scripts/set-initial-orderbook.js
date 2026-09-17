// initial snapshot orderbook data
const { createWalletClient, http } = require("viem")
const { privateKeyToAccount } = require("viem/accounts")
const { mainnet } = require("viem/chains")
const https = require("https")

// Binance REST API endpoint
const API_BASE = "https://api.binance.com/api/v3"

const ELYSIA_PERP_API_URL = "http://localhost:3001"

// Markets to fetch
const MARKETS = ["btcusdt", "ethusdt"]

// Helper function to fetch orderbook snapshot
function fetchOrderbookSnapshot(symbol, limit = 100) {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`

    https
      .get(url, (res) => {
        let data = ""

        res.on("data", (chunk) => {
          data += chunk
        })

        res.on("end", () => {
          try {
            const orderbook = JSON.parse(data)
            resolve(orderbook)
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`))
          }
        })
      })
      .on("error", (error) => {
        reject(error)
      })
  })
}

// Helper function to aggregate by integer price and calculate total volume
function aggregateByIntegerPrice(entries, priceUnit = 1) {
  const aggregated = {}

  entries.forEach(([price, quantity]) => {
    const priceValue = parseFloat(price)
    // Round to the nearest price unit (100 for BTC, 1 for ETH)
    const intPrice = Math.round(priceValue / priceUnit) * priceUnit
    const qty = parseFloat(quantity)

    if (intPrice > 0 && qty > 0) {
      if (!aggregated[intPrice]) {
        aggregated[intPrice] = 0
      }
      aggregated[intPrice] += qty
    }
  })

  // Convert to array and sort
  return Object.entries(aggregated)
    .map(([price, totalVolume]) => [parseInt(price), totalVolume])
    .sort((a, b) => b[0] - a[0]) // Sort by price descending for bids
}

// Market ID mapping (BTC/USDT = 1, ETH/USDT = 2)
const MARKET_IDS = {
  btcusdt: 1,
  ethusdt: 9269,
}

// Process and display orderbook
async function processOrderbook(market) {
  try {
    console.log(`\nFetching initial snapshot for ${market.toUpperCase()}...`)

    // Use maximum limit (5000) to get as much data as possible
    const orderbook = await fetchOrderbookSnapshot(market, 5000)

    const rawBidsCount = (orderbook.bids || []).length
    const rawAsksCount = (orderbook.asks || []).length
    console.log(
      `Received ${rawBidsCount} BID entries and ${rawAsksCount} ASK entries`
    )

    // Determine price unit: 100 for BTC, 1 for ETH
    const priceUnit = market.toLowerCase() === "btcusdt" ? 100 : 1

    // Aggregate bids by integer price
    const aggregatedBids = aggregateByIntegerPrice(
      orderbook.bids || [],
      priceUnit
    )
    // Aggregate asks by integer price (sort ascending)
    const aggregatedAsks = aggregateByIntegerPrice(
      orderbook.asks || [],
      priceUnit
    ).sort((a, b) => a[0] - b[0]) // Sort ascending for asks

    const priceUnitLabel = priceUnit === 100 ? "100-unit" : "1-unit"
    console.log(
      `\n${market.toUpperCase()} Initial Orderbook Snapshot (${priceUnitLabel}):`
    )
    console.log("═".repeat(70))
    console.log("BIDS (Buy orders) - Price (Integer) | Total Volume:")
    console.log("─".repeat(70))
    // Show all aggregated bids (or up to 50 for readability)
    aggregatedBids.slice(0, 50).forEach(([price, totalVolume]) => {
      console.log(
        `  Price: ${price.toString().padStart(10)} | Total Volume: ${totalVolume.toFixed(8)}`
      )
    })
    if (aggregatedBids.length > 50) {
      console.log(`  ... and ${aggregatedBids.length - 50} more BID levels`)
    }

    console.log("\nASKS (Sell orders) - Price (Integer) | Total Volume:")
    console.log("─".repeat(70))
    // Show all aggregated asks (or up to 50 for readability)
    aggregatedAsks.slice(0, 50).forEach(([price, totalVolume]) => {
      console.log(
        `  Price: ${price.toString().padStart(10)} | Total Volume: ${totalVolume.toFixed(8)}`
      )
    })
    if (aggregatedAsks.length > 50) {
      console.log(`  ... and ${aggregatedAsks.length - 50} more ASK levels`)
    }
    console.log("═".repeat(70))

    // Summary
    const totalBidVolume = aggregatedBids.reduce((sum, [, vol]) => sum + vol, 0)
    const totalAskVolume = aggregatedAsks.reduce((sum, [, vol]) => sum + vol, 0)
    console.log(`\nSummary:`)
    console.log(
      `  Raw entries received: ${rawBidsCount} BIDS, ${rawAsksCount} ASKS`
    )
    console.log(`  Total BID volume: ${totalBidVolume.toFixed(8)}`)
    console.log(`  Total ASK volume: ${totalAskVolume.toFixed(8)}`)
    console.log(`  Aggregated price levels (BIDS): ${aggregatedBids.length}`)
    console.log(`  Aggregated price levels (ASKS): ${aggregatedAsks.length}`)

    // Return aggregated data for order creation
    return {
      market,
      marketId: MARKET_IDS[market.toLowerCase()],
      bids: aggregatedBids,
      asks: aggregatedAsks,
    }
  } catch (error) {
    console.error(`Error fetching ${market} orderbook:`, error.message)
    return null
  }
}

// Main execution
async function main() {
  console.log("Fetching initial orderbook snapshots from Binance...")
  console.log(`Markets: ${MARKETS.map((m) => m.toUpperCase()).join(", ")}\n`)

  const orderbookData = []
  for (const market of MARKETS) {
    const data = await processOrderbook(market)
    if (data) {
      orderbookData.push(data)
    }
  }

  console.log("\nOrderbook data fetched!\n")

  // Generate orders from aggregated orderbook data
  const orders = []
  for (const data of orderbookData) {
    // Create BID orders (buy orders)
    for (const [price, volume] of data.bids) {
      orders.push({
        market_id: data.marketId,
        side: "bid",
        price: Math.ceil(price),
        size: Math.ceil(volume),
      })
    }

    // Create ASK orders (sell orders)
    for (const [price, volume] of data.asks) {
      orders.push({
        market_id: data.marketId,
        side: "ask",
        price: Math.ceil(price),
        size: Math.ceil(volume),
      })
    }
  }

  console.log(`Generated ${orders.length} orders from orderbook data\n`)

  await createNewAccountAndDepositAndMakeOrders(orders)
}

main().catch(console.error)

async function createNewAccountAndDepositAndMakeOrders(orders) {
  const privateKey = getRandomPrivateKey()

  const client = createWalletClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  })

  const account = privateKeyToAccount(privateKey)
  const url = `${ELYSIA_PERP_API_URL}/auth/nonce?address=${account.address}`
  const response = await fetch(url)
  const data = await response.json()
  console.log(data)

  const domain = {
    name: "ELSIA_PERP",
    version: "1",
    chainId: 11155111, // Ethereum Mainnet (DEFAULT_CHAIN_ID)
    // verifyingContract는 필요하지 않으면 제거
  }

  // Message to sign
  const message = {
    user: account.address,
    nonce: data.nonce,
  }

  // Typed data structure
  const types = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
    ],
    LoginMessage: [
      { name: "user", type: "address" },
      { name: "nonce", type: "string" },
    ],
  }

  const signature = await client.signTypedData({
    account: account,
    domain: domain,
    types: types,
    primaryType: "LoginMessage",
    message: message,
  })

  const loginUrl = `${ELYSIA_PERP_API_URL}/auth/login`
  const loginResponse = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: account.address,
      signature: signature,
      nonce: data.nonce, // 백엔드에서 nonce 검증에 필요
    }),
  })

  const setCookieHeaders = loginResponse.headers.getSetCookie?.() || []
  let cookies = ""

  if (setCookieHeaders.length > 0) {
    cookies = setCookieHeaders.map((cookie) => cookie.split(";")[0]).join("; ")
  } else {
    const setCookieHeader = loginResponse.headers.get("set-cookie")
    if (setCookieHeader) {
      const cookieStrings = Array.isArray(setCookieHeader)
        ? setCookieHeader
        : [setCookieHeader]

      cookies = cookieStrings.map((cookie) => cookie.split(";")[0]).join("; ")
    }
  }

  const depositAmount = 100000000000000
  const BTC_ID = 3762
  const ETH_ID = 3928
  const USD_ID = 840

  const depositUrl = `${ELYSIA_PERP_API_URL}/account/deposit`
  const depositResponse = await fetch(depositUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({
      asset_id: BTC_ID,
      amount: depositAmount,
    }),
  })

  const depositResponseETH = await fetch(depositUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({
      asset_id: ETH_ID,
      amount: depositAmount,
    }),
  })

  const depositResponseUSD = await fetch(depositUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({
      asset_id: USD_ID,
      amount: depositAmount,
    }),
  })

  if (!depositResponse.ok || !depositResponseETH.ok || !depositResponseUSD.ok) {
    const errorText = await depositResponse.text()
    const errorTextETH = await depositResponseETH.text()
    const errorTextUSD = await depositResponseUSD.text()
    console.error("Deposit failed:", depositResponse.status, errorText)
    console.error("Deposit failed:", depositResponseETH.status, errorTextETH)
    console.error("Deposit failed:", depositResponseUSD.status, errorTextUSD)
    return
  }

  console.log("\nCreating orders...\n")

  const orderUrl = `${ELYSIA_PERP_API_URL}/order`
  let successCount = 0
  let failCount = 0

  for (const order of orders) {
    try {
      const orderResponse = await fetch(orderUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookies,
        },
        body: JSON.stringify({
          market_id: order.market_id,
          side: order.side,
          price: order.price,
          size: order.size,
        }),
      })

      if (orderResponse.ok) {
        const orderData = await orderResponse.json()
        console.log(
          `Order created: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market_id: ${order.market_id}, order_id: ${orderData.order_id})`
        )
        successCount++
      } else {
        const errorText = await orderResponse.text()
        console.error(
          `Order failed: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market_id: ${order.market_id}) - ${orderResponse.status}: ${errorText}`
        )
        failCount++
      }

      // Small delay to avoid overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      console.error(
        `Order error: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market_id: ${order.market_id}) - ${error.message}`
      )
      failCount++
    }
  }

  console.log(`\nOrder creation summary:`)
  console.log(`  Success: ${successCount}`)
  console.log(`  Failed: ${failCount}`)
  console.log(`  Total: ${orders.length}\n`)
}

function getRandomPrivateKey() {
  let randomPrivateKey = "0x"
  for (let j = 0; j < 64; j++) {
    randomPrivateKey += Math.floor(Math.random() * 16).toString(16)
  }
  return randomPrivateKey
}
