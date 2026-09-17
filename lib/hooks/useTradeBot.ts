"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { privateKeyToAccount } from "viem/accounts"

// Binance WebSocket endpoint
const WS_URL = "wss://stream.binance.com:9443/ws/"

// Markets to subscribe to
const MARKETS = ["btcusdt", "ethusdt"] as const

// Market ID mapping (BTC/USDT = 100, ETH/USDT = 101)
const MARKET_IDS: Record<string, number> = {
  btcusdt: 100,
  ethusdt: 101,
}

interface MarketAccount {
  cookies: string
  account: ReturnType<typeof privateKeyToAccount>
}

// Store authenticated accounts per market (reuse accounts for efficiency)
const marketAccounts = new Map<string, MarketAccount>()

function getRandomPrivateKey(): `0x${string}` {
  let randomPrivateKey = "0x"
  for (let j = 0; j < 64; j++) {
    randomPrivateKey += Math.floor(Math.random() * 16).toString(16)
  }
  return randomPrivateKey as `0x${string}`
}

// Create and authenticate account, then deposit (서버 사이드 API 사용)
// forceNew: true면 기존 계정을 무시하고 새로 생성
async function createAccountAndDeposit(
  market: string,
  forceNew: boolean = false
): Promise<MarketAccount> {
  // forceNew가 false이고 이미 계정이 있으면 재사용
  if (!forceNew && marketAccounts.has(market)) {
    return marketAccounts.get(market)!
  }

  // 서버 사이드 API를 통해 계정 생성, 로그인, 입금 처리
  const response = await fetch("/api/trade-bot/create-account", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ market }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      errorData.error || `Failed to create account: ${response.statusText}`
    )
  }

  const result = await response.json()

  if (!result.success || !result.cookies) {
    throw new Error("Failed to create account: Invalid response")
  }

  // 서버에서 받은 쿠키와 주소를 사용하여 account 객체 생성
  // (실제로는 서버에서 private key를 반환하지 않으므로, 주소만 저장)
  // 하지만 쿠키만 있으면 API 호출이 가능하므로, account는 더미 객체로 생성
  const account = privateKeyToAccount(getRandomPrivateKey())

  // 주소는 서버에서 받은 주소로 업데이트 (실제로는 사용하지 않지만 일관성을 위해)
  console.log(
    `\nAccount created and deposits completed for ${market.toUpperCase()}`
  )
  console.log(`Address: ${result.address}\n`)

  const accountData: MarketAccount = {
    cookies: result.cookies,
    account,
  }
  marketAccounts.set(market, accountData)
  return accountData
}

interface Order {
  market: string
  side: "Long" | "Short"
  price: string
  size: string
  leverage: string
}

// Create a single order (서버 사이드 API 사용)
async function createOrder(
  market: string,
  order: Order,
  cookies: string
): Promise<{
  success: boolean
  orderData?: unknown
  error?: string
  code?: string
  cookies?: string
}> {
  try {
    const response = await fetch("/api/trade-bot/create-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        market,
        order,
        cookies,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error(
        `✗ Order failed: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market: ${order.market}) - ${response.status}: ${errorData.error || response.statusText}`
      )
      return {
        success: false,
        error: errorData.error || response.statusText,
        code: errorData.code,
        cookies: errorData.cookies,
      }
    }

    const result = await response.json()

    if (result.success) {
      console.log(
        `✓ Order created: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market: ${order.market}, order_id: ${result.orderData?.order_id})`
      )

      // 쿠키가 업데이트되었으면 저장
      if (result.cookies && result.cookies !== cookies) {
        const accountData = marketAccounts.get(market)
        if (accountData) {
          accountData.cookies = result.cookies
          marketAccounts.set(market, accountData)
        }
      }

      return {
        success: true,
        orderData: result.orderData,
        cookies: result.cookies,
      }
    } else {
      console.error(
        `✗ Order failed: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market: ${order.market}) - ${result.error}`
      )
      return {
        success: false,
        error: result.error,
        code: result.code,
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"
    console.error(
      `✗ Order error: ${order.side.toUpperCase()} ${order.size} @ ${order.price} (market: ${order.market}) - ${errorMessage}`
    )
    return { success: false, error: errorMessage }
  }
}

export function useTradeBot() {
  const [isActive, setIsActive] = useState(false)
  const isProcessingRef = useRef<boolean>(false)
  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map())
  // 구매자와 판매자 계정 분리
  const buyerAccountRef = useRef<MarketAccount | null>(null)
  const sellerAccountRef = useRef<MarketAccount | null>(null)
  const buyerInitializedRef = useRef<boolean>(false)
  const sellerInitializedRef = useRef<boolean>(false)

  const startBot = useCallback(async () => {
    if (isActive || isProcessingRef.current) return
    isProcessingRef.current = true

    console.log("Starting Binance trade stream...")
    console.log(
      `Subscribing to: ${MARKETS.map((m) => m.toUpperCase()).join(", ")}\n`
    )
    console.log("Waiting for trades to create orders...\n")

    // Switch on 할 때마다 새로운 계정 생성 (쿠키 새로 받기)
    // 기존 계정 초기화
    marketAccounts.clear()
    buyerInitializedRef.current = false
    sellerInitializedRef.current = false
    buyerAccountRef.current = null
    sellerAccountRef.current = null

    // 구매자와 판매자 계정 각각 생성
    try {
      const [buyerAccountData, sellerAccountData] = await Promise.all([
        createAccountAndDeposit("trade-bot-buyer", true),
        createAccountAndDeposit("trade-bot-seller", true),
      ])

      buyerAccountRef.current = buyerAccountData
      sellerAccountRef.current = sellerAccountData
      buyerInitializedRef.current = true
      sellerInitializedRef.current = true

      console.log(`\n✓ Created buyer account for all markets\n`)
      console.log(`✓ Created seller account for all markets\n`)
    } catch (error) {
      console.error(`Failed to create accounts:`, error)
      isProcessingRef.current = false
      return
    }

    MARKETS.forEach((market) => {
      const ws = new WebSocket(`${WS_URL}${market}@trade`)

      ws.onopen = () => {
        console.log(
          `\nConnected to Binance Trade Stream for ${market.toUpperCase()}\n`
        )
      }

      ws.onmessage = async (event) => {
        try {
          if (Math.random() > 0.1) return
          const trade = JSON.parse(event.data as string)

          // Binance trade format: { e: 'trade', p: 'price', q: 'quantity', s: 'BUY' or 'SELL', ... }
          if (trade.e !== "trade") {
            return
          }

          const marketId = MARKET_IDS[market.toLowerCase()]
          if (!marketId) {
            console.error(`Unknown market ID for ${market}`)
            return
          }

          const price = parseFloat(trade.p)
          const quantity =
            (parseFloat(trade.q) < 0.0001 ? 0.001 : parseFloat(trade.q)) + 0.001
          const isBuyer = Math.random() < 0.5
          const side = isBuyer ? "bid" : "ask"
          const priceOffset = Math.random() < 0.5 ? (isBuyer ? -1 : 1) : 0
          const adjustedPrice = price + priceOffset

          // Skip if invalid values
          if (price <= 0 || quantity <= 0) {
            return
          }

          console.log(
            `\n[${market.toUpperCase()}] Trade: ${side.toUpperCase()} ${quantity} @ ${adjustedPrice} (original: ${price}, offset: ${priceOffset})`
          )

          // 구매자/판매자에 따라 적절한 계정 사용
          const accountData = isBuyer
            ? buyerAccountRef.current
            : sellerAccountRef.current

          const isInitialized = isBuyer
            ? buyerInitializedRef.current
            : sellerInitializedRef.current

          if (!accountData || !isInitialized) {
            console.error(
              `${isBuyer ? "Buyer" : "Seller"} account not initialized, closing connections...`
            )

            wsConnectionsRef.current.forEach((conn) => {
              if (conn.readyState === WebSocket.OPEN) {
                conn.close()
              }
            })
            wsConnectionsRef.current.clear()
            buyerInitializedRef.current = false
            sellerInitializedRef.current = false
            buyerAccountRef.current = null
            sellerAccountRef.current = null
            setIsActive(false)
            return
          }

          // Create order matching the trade
          const order: Order = {
            market: marketId.toString(),
            side: isBuyer ? "Long" : "Short",
            price: adjustedPrice.toString(),
            size: quantity.toString(),
            leverage: "1",
          }

          let orderResult = await createOrder(
            marketId.toString(),
            order,
            accountData.cookies
          )

          // Refresh token 만료 시 계정 재생성 후 재시도
          if (!orderResult.success && orderResult.code === "REFRESH_FAILED") {
            console.log(
              `Refresh token expired for ${isBuyer ? "buyer" : "seller"}, re-creating account...`
            )
            try {
              const newAccount = await createAccountAndDeposit(
                isBuyer ? "trade-bot-buyer" : "trade-bot-seller",
                true
              )
              if (isBuyer) {
                buyerAccountRef.current = newAccount
              } else {
                sellerAccountRef.current = newAccount
              }
              // 새 쿠키로 재시도
              orderResult = await createOrder(
                marketId.toString(),
                order,
                newAccount.cookies
              )
            } catch (reAuthError) {
              console.error("Re-authentication failed:", reAuthError)
            }
          }

          // 쿠키가 업데이트되었으면 해당 계정에 저장
          if (
            orderResult.cookies &&
            orderResult.cookies !== accountData.cookies
          ) {
            if (isBuyer && buyerAccountRef.current) {
              buyerAccountRef.current.cookies = orderResult.cookies
            } else if (!isBuyer && sellerAccountRef.current) {
              sellerAccountRef.current.cookies = orderResult.cookies
            }
          }

          // 주문 생성 성공 시 차트 업데이트를 위한 이벤트 발생
          if (orderResult.success && orderResult.orderData) {
            const orderCreatedEvent = new CustomEvent("orderCreated", {
              detail: {
                market,
                market_id: marketId,
                side: order.side,
                price: parseFloat(order.price),
                size: parseFloat(order.size),
                orderData: orderResult.orderData,
                timestamp: Date.now(),
              },
            })
            window.dispatchEvent(orderCreatedEvent)
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error"
          console.error(`Error processing ${market} trade:`, errorMessage)
        }
      }

      ws.onerror = (error) => {
        console.error(`WebSocket error for ${market}:`, error)
      }

      ws.onclose = () => {
        console.log(
          `\nDisconnected from ${market.toUpperCase()} Trade Stream\n`
        )
      }

      wsConnectionsRef.current.set(market, ws)
    })

    setIsActive(true)
    isProcessingRef.current = false
  }, [isActive])

  const stopBot = useCallback(() => {
    if (!isActive || isProcessingRef.current) return
    isProcessingRef.current = true

    console.log("Stopping Binance trade stream...")

    // Close all WebSocket connections
    wsConnectionsRef.current.forEach((ws) => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close()
      }
    })
    wsConnectionsRef.current.clear()

    // Reset initialization flags and account data
    buyerInitializedRef.current = false
    sellerInitializedRef.current = false
    buyerAccountRef.current = null
    sellerAccountRef.current = null
    // marketAccounts는 유지 (재사용 가능하지만 startBot에서 forceNew로 새로 생성)

    setIsActive(false)
    isProcessingRef.current = false
  }, [isActive])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBot()
    }
  }, [stopBot])

  const toggleBot = useCallback(() => {
    if (isActive) {
      stopBot()
    } else {
      startBot()
    }
  }, [isActive, startBot, stopBot])

  return {
    isActive,
    startBot,
    stopBot,
    toggleBot,
  }
}
