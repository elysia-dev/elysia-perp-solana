"use client"

import { useEffect } from "react"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"

interface WsTradeData {
  maker_user_id: number
  taker_user_id: number
  market_id: number
  price: number
  size: number
  maker_order_id: number
  taker_order_id: number
  timestamp: number
}

interface WsTradeMessage {
  type: string
  channel: string
  data: WsTradeData
}

/**
 * Subscribes to trade/{market_id} via WebSocket and dispatches
 * `tradeExecuted` window events for the chart.
 */
export function useMarketTrades(market: string, marketId: number) {
  const { subscribe } = useWebSocket()
  const { data: detailsData } = useOrderBookDetails()

  const marketDetail = detailsData?.order_book_details?.find(
    (d) => d.market_id === marketId
  )
  const priceDecimals = marketDetail?.price_decimals ?? 1
  const sizeDecimals = marketDetail?.size_decimals ?? 5

  useEffect(() => {
    if (marketId <= 0) return

    const channel = `trade/${marketId}`

    const unsubscribe = subscribe(channel, (raw: unknown) => {
      const msg = raw as WsTradeMessage
      if (msg.type !== "update/trade" || !msg.data) return

      const trade = msg.data
      const price = trade.price / Math.pow(10, priceDecimals)
      const size = trade.size / Math.pow(10, sizeDecimals)

      window.dispatchEvent(
        new CustomEvent("tradeExecuted", {
          detail: {
            market,
            market_id: marketId,
            side: "buy", // WS trade doesn't have explicit side
            price,
            size,
            timestamp: trade.timestamp,
          },
        })
      )
    })

    return unsubscribe
  }, [market, marketId, priceDecimals, sizeDecimals, subscribe])
}
