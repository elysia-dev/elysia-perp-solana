"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { useSelectedPair, useMarketStore } from "@/lib/stores"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { apiClient } from "@/lib/api/client"

// The trades API returns `created_at` in a NON-ISO shape that `new Date()`
// rejects (→ "Invalid Date") in Safari and Chrome, e.g.
//   "2026-07-14 20:59:33.532363 +00:00"
// (space instead of `T`, microsecond precision, a space before the offset).
// Normalise to ISO 8601 (T separator, ≤3 fractional digits, no space) → ms.
// Returns NaN for an unparseable value so callers can fall back.
function parseCreatedAtMs(createdAt: string): number {
  const direct = new Date(createdAt).getTime()
  if (!Number.isNaN(direct)) return direct
  const iso = createdAt
    .replace(" ", "T") // date/time separator
    .replace(" ", "") // drop the space before the timezone offset
    .replace(/(\.\d{3})\d+/, "$1") // microseconds → milliseconds
  return new Date(iso).getTime()
}

interface MarketTradeResponse {
  trades: {
    id: number
    market: string
    price: string
    size: string
    is_maker_ask: boolean
    created_at: string
  }[]
}

interface Trade {
  id: number
  price: number
  size: number
  side: "buy" | "sell"
  timestamp: number
}

interface WsTradeData {
  maker_user_id: number
  taker_user_id: number
  market_id: number
  price: number
  size: number
  maker_order_id: number
  taker_order_id: number
  timestamp: number
  is_maker_ask?: boolean
  is_taker_bid?: boolean
}

interface WsTradeMessage {
  type: string
  channel: string
  data: WsTradeData | WsTradeData[]
}

const MAX_TRADES = 50

export function RecentTrades() {
  const pair = useSelectedPair()
  // Gate the REST fetch on the real market list: before it loads, the
  // selected pair is the DEFAULT_PAIR placeholder whose name lacks the
  // collateral suffix ("BTC-PERP"), and the trades endpoint only knows full
  // names — the placeholder request just 400s and is thrown away. Same gate
  // the chart uses for the identical reason.
  const marketsLoaded = useMarketStore((s) => s.marketsLoaded)
  const { subscribe } = useWebSocket()
  const { data: detailsData } = useOrderBookDetails()
  const tradesRef = useRef<Trade[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const skeletonContainerRef = useRef<HTMLDivElement>(null)
  const idCounter = useRef(0)
  const [loaded, setLoaded] = useState(false)
  // Skeleton row count is computed from the container height so the placeholder
  // fills the panel instead of stopping halfway. Each row is h-5 (20px).
  const SKELETON_ROW_H = 20
  const [skeletonRows, setSkeletonRows] = useState(20)

  const marketDetail = detailsData?.order_book_details?.find(
    (d) => d.market_id === pair.id
  )
  const priceDecimals = marketDetail?.price_decimals ?? 1
  const sizeDecimals = marketDetail?.size_decimals ?? 5

  const renderTrades = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const trades = tradesRef.current
    const html = trades
      .map((t) => {
        const isBuy = t.side === "buy"
        const bgClass = isBuy ? "bg-success/5" : "bg-destructive/5"
        const hoverClass = isBuy
          ? "hover:bg-success/10"
          : "hover:bg-destructive/10"
        const sizeColor = isBuy ? "text-success" : "text-destructive"
        // timestamp는 마이크로초 단위 → 밀리초로 변환
        const time = new Date(t.timestamp / 1000)
        const timeStr = Number.isNaN(time.getTime())
          ? "--:--:--"
          : time.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })

        return `<div class="flex w-full items-center px-2 text-xs h-5 cursor-pointer ${bgClass} ${hoverClass} group">
          <div class="flex-1 group-hover:text-foreground text-muted-foreground">${timeStr}</div>
          <div class="flex-1 text-center ${sizeColor}">${t.size.toFixed(sizeDecimals)}</div>
          <div class="flex-1 text-right group-hover:text-foreground text-muted-foreground">${t.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
        </div>`
      })
      .join("")

    container.innerHTML = html
  }, [sizeDecimals])

  // Load initial trades via REST, then subscribe to WebSocket for updates
  useEffect(() => {
    if (!marketsLoaded || pair.id <= 0) return

    tradesRef.current = []
    setLoaded(false)
    renderTrades()

    let cancelled = false

    // 1. REST: load recent 20 trades
    apiClient<MarketTradeResponse>(`/markets/${pair.name}/trades?limit=50`)
      .then((data) => {
        if (cancelled) return
        const trades = (data.trades || []).map((t) => ({
          id: idCounter.current++,
          price: parseFloat(t.price),
          size: parseFloat(t.size),
          side: (t.is_maker_ask ? "buy" : "sell") as "buy" | "sell",
          timestamp: parseCreatedAtMs(t.created_at) * 1000, // ms → μs
        }))
        tradesRef.current = trades.slice(0, MAX_TRADES)
        renderTrades()
        setLoaded(true)
      })
      .catch(() => {
        // REST failed, will rely on WebSocket snapshot
      })

    // 2. WebSocket: subscribe for real-time updates
    const channel = `trade/${pair.id}`

    const unsubscribe = subscribe(channel, (raw: unknown) => {
      const msg = raw as WsTradeMessage

      if (msg.type === "subscribed/trade" && msg.data) {
        // WS snapshot — merge with REST data (WS may have newer trades)
        const dataArray = Array.isArray(msg.data) ? msg.data : [msg.data]
        const wsTrades: Trade[] = dataArray.map((d) => ({
          id: idCounter.current++,
          price: d.price / Math.pow(10, priceDecimals),
          size: d.size / Math.pow(10, sizeDecimals),
          side: (d.is_maker_ask ? "buy" : "sell") as "buy" | "sell",
          timestamp: d.timestamp,
        }))

        if (tradesRef.current.length === 0) {
          // REST hasn't loaded yet, use WS snapshot
          tradesRef.current = wsTrades.slice(-MAX_TRADES)
        }
        // If REST already loaded, keep it (usually has more history)
        renderTrades()
        setLoaded(true)
        return
      }

      if (msg.type === "update/trade" && msg.data) {
        const dataArray = Array.isArray(msg.data) ? msg.data : [msg.data]
        for (const d of dataArray) {
          const trade: Trade = {
            id: idCounter.current++,
            price: d.price / Math.pow(10, priceDecimals),
            size: d.size / Math.pow(10, sizeDecimals),
            side: (d.is_maker_ask ? "buy" : "sell") as "buy" | "sell",
            timestamp: d.timestamp,
          }
          tradesRef.current.unshift(trade)
          if (tradesRef.current.length > MAX_TRADES) {
            tradesRef.current.pop()
          }
        }
        renderTrades()
        setLoaded(true)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [
    marketsLoaded,
    pair.id,
    pair.name,
    priceDecimals,
    sizeDecimals,
    subscribe,
    renderTrades,
  ])

  // Resize observer for skeleton — only active while loading.
  useEffect(() => {
    if (loaded) return
    const el = skeletonContainerRef.current
    if (!el) return
    const calc = () => {
      const h = el.clientHeight
      if (h > 0) {
        setSkeletonRows(Math.max(8, Math.ceil(h / SKELETON_ROW_H)))
      }
    }
    calc()
    const obs = new ResizeObserver(calc)
    obs.observe(el)
    return () => obs.disconnect()
  }, [loaded])

  return (
    <div className="relative h-full min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex w-full items-center px-2 h-8 shrink-0 text-xs font-medium text-muted-foreground bg-card">
        <div className="flex-1">Time</div>
        <div className="flex-1 text-center">
          <span className="inline-flex items-center gap-1">
            Size
            <span className="inline-flex h-4 items-center rounded-sm border border-border bg-muted px-1 text-[10px] text-muted-foreground">
              {pair.base}
            </span>
          </span>
        </div>
        <div className="flex-1 text-right">Price</div>
      </div>

      {/* Trades list — DOM manipulated directly for perf */}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 overflow-y-auto" />
        {!loaded && (
          <div
            ref={skeletonContainerRef}
            className="pointer-events-none absolute inset-0 flex flex-col overflow-hidden"
          >
            {Array.from({ length: skeletonRows }).map((_, i) => (
              <div
                key={i}
                className="flex w-full items-center gap-2 px-2 h-5 shrink-0"
              >
                <div className="flex-1">
                  <div className="h-2 w-12 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="h-2 w-10 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex-1 flex justify-end">
                  <div className="h-2 w-14 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
