"use client"

import { useMarketStore, useSelectedPair } from "@/lib/stores"
import { getAssetName } from "@/lib/utils"
import { useOrderbook } from "@/lib/hooks/useOrderbook"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Orderbook, OrderEntry } from "@/types"

type ViewMode = "all" | "bids" | "asks"

const DEPTH_OPTIONS_BY_MARKET: Record<string, string[]> = {
  BTC: ["0.1", "1", "10", "100"],
  ETH: ["0.01", "0.1", "1", "10"],
}
const DEFAULT_DEPTH_OPTIONS = ["0.1", "1", "10", "100"]

const SIZE_SCALE = 1e10

function toScaled(value: string): number {
  return Math.round(parseFloat(value) * SIZE_SCALE)
}

function fromScaled(scaled: number, decimals: number = 8): string {
  return (scaled / SIZE_SCALE).toFixed(decimals).replace(/\.?0+$/, "")
}

function groupOrders(
  orders: OrderEntry[],
  groupSize: number,
  side: "bid" | "ask"
): OrderEntry[] {
  // Determine decimal places from groupSize to use integer math (avoid floating-point errors)
  const groupDecimals = Math.max(0, -Math.floor(Math.log10(groupSize) - 0.0001))
  const scale = Math.pow(10, groupDecimals)
  const groupSizeInt = Math.round(groupSize * scale)

  // No grouping needed when groupSize matches the data's native precision
  if (groupSizeInt <= 1) {
    return [...orders].sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
  }

  const grouped = new Map<number, { sizeScaled: number; orders: number }>()
  const roundFn = side === "bid" ? Math.floor : Math.ceil

  orders.forEach((entry) => {
    const priceInt = Math.round(parseFloat(entry.price) * scale)
    // Group using integer arithmetic, then convert back
    const groupedPriceInt = roundFn(priceInt / groupSizeInt) * groupSizeInt
    const existing = grouped.get(groupedPriceInt)
    if (existing) {
      existing.sizeScaled += toScaled(entry.size)
      existing.orders += parseInt(entry.orders || "1")
    } else {
      grouped.set(groupedPriceInt, {
        sizeScaled: toScaled(entry.size),
        orders: parseInt(entry.orders || "1"),
      })
    }
  })

  return Array.from(grouped.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([priceInt, data]) => ({
      price: (priceInt / scale).toFixed(groupDecimals),
      size: fromScaled(data.sizeScaled),
      orders: data.orders.toString(),
    }))
}

// ── Reusable inner renderer ──

interface OrderBookViewProps {
  data: Orderbook | undefined
  label?: string
  /** false일 때 외부 wrapper가 header를 제공 (탭 구조 등) */
  showHeader?: boolean
}

export function OrderBookView({
  data,
  label,
  showHeader = true,
}: OrderBookViewProps) {
  const pair = useSelectedPair()
  const setSelectedPrice = useMarketStore((s) => s.setSelectedPrice)
  const { data: detailsData } = useOrderBookDetails()
  const marketDetail = detailsData?.order_book_details?.find(
    (d) => d.market_id === pair.id
  )
  const priceDecimals = marketDetail?.price_decimals ?? 1
  const [amountDenom, setAmountDenom] = useState<"base" | "quote">("quote")
  const depthOptions =
    DEPTH_OPTIONS_BY_MARKET[pair.base] ?? DEFAULT_DEPTH_OPTIONS
  const [depth, setDepth] = useState(depthOptions[0])
  const [viewMode, setViewMode] = useState<ViewMode>("all")

  useEffect(() => {
    const options = DEPTH_OPTIONS_BY_MARKET[pair.base] ?? DEFAULT_DEPTH_OPTIONS
    setDepth(options[0])
  }, [pair.base])

  const baseSymbol = pair.base
  // Quote symbol follows the *selected market* (e.g. BTC-PERP-ARB → "ARB"),
  // not the global ecosystem browse filter — those can diverge on URL deep
  // links and when the user changes the ecosystem sidebar without
  // selecting a market. Without this, the size column header would read
  // "Size (EL$)" on an ARB-quoted orderbook.
  //
  // `getAssetName` is the same source PositionsTab / TradingForm read
  // from, so the symbol stays consistent across the page (EL: "EL$",
  // ARB: "ARB", USDT: "USDT" — the `$` is part of asset 5382's
  // canonical symbol metadata, not a manual suffix).
  const quoteSymbol = getAssetName(pair.quote_currency)

  // Dynamically calculate maxRows from container height
  const ROW_H = 23 // 22px row + 1px gap
  const sideRef = useRef<HTMLDivElement>(null)
  const [maxRows, setMaxRows] = useState(viewMode === "all" ? 11 : 20)

  const calcRows = useCallback(() => {
    const el = sideRef.current
    if (!el) return
    const h = el.clientHeight
    const rows = Math.max(3, Math.floor(h / ROW_H))
    setMaxRows(rows)
  }, [])

  useEffect(() => {
    calcRows()
    const el = sideRef.current
    if (!el) return
    const obs = new ResizeObserver(calcRows)
    obs.observe(el)
    return () => obs.disconnect()
  }, [calcRows, viewMode])

  const { asks, bids, cumulativeAsks, cumulativeBids } = useMemo(() => {
    if (!data) {
      return { asks: [], bids: [], cumulativeAsks: [], cumulativeBids: [] }
    }

    const groupSize = parseFloat(depth)
    const allAsks = groupOrders(data.asks, groupSize, "ask")
    const groupedAsks = allAsks.slice(-maxRows)
    const groupedBids = groupOrders(data.bids, groupSize, "bid").slice(
      0,
      maxRows
    )

    // Cumulative from spread outward (bottom to top for asks)
    const cumulativeAskScaled: number[] = new Array(groupedAsks.length).fill(0)
    for (let i = groupedAsks.length - 1; i >= 0; i--) {
      const sizeScaled =
        amountDenom === "quote"
          ? Math.round(
              toScaled(groupedAsks[i].size) * parseFloat(groupedAsks[i].price)
            )
          : toScaled(groupedAsks[i].size)
      const next = i < groupedAsks.length - 1 ? cumulativeAskScaled[i + 1] : 0
      cumulativeAskScaled[i] = sizeScaled + next
    }
    const newCumulativeAsks = cumulativeAskScaled.map((v) => v / SIZE_SCALE)

    const cumulativeBidScaled: number[] = []
    groupedBids.forEach((bid, i) => {
      const sizeScaled =
        amountDenom === "quote"
          ? Math.round(toScaled(bid.size) * parseFloat(bid.price))
          : toScaled(bid.size)
      const prev = i > 0 ? cumulativeBidScaled[i - 1] : 0
      cumulativeBidScaled.push(sizeScaled + prev)
    })
    const newCumulativeBids = cumulativeBidScaled.map((v) => v / SIZE_SCALE)

    return {
      asks: groupedAsks,
      bids: groupedBids,
      cumulativeAsks: newCumulativeAsks,
      cumulativeBids: newCumulativeBids,
    }
  }, [data, amountDenom, depth, maxRows])

  // Distinguish "still loading the book" from "genuinely no quotes".
  // The backend sends NO `subscribed/order_book` for a market with no cached
  // book, so we can't wait on a snapshot indefinitely — we time-box the
  // initial load: show a skeleton until the book arrives, and only fall back
  // to the "No active orders" message once a short grace window elapses with
  // still no data. Resets whenever the selected market changes.
  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    setGraceElapsed(false)
    const t = setTimeout(() => setGraceElapsed(true), 1500)
    return () => clearTimeout(t)
  }, [pair.id])
  const showLoading = !data && !graceElapsed

  const formatAmount = (size: string, price: string) => {
    if (amountDenom === "quote") {
      const scaled = Math.round(toScaled(size) * parseFloat(price))
      return (scaled / SIZE_SCALE).toFixed(4)
    }
    return size
  }

  const formatPrice = (price: string) => {
    return parseFloat(price).toFixed(priceDecimals)
  }

  return (
    <div
      className={`flex h-full flex-col ${showHeader ? "rounded-lg bg-card" : ""}`}
    >
      {showHeader && (
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold">
            Order Book
            {label && (
              <span className="ml-2 text-xs text-yellow-500">({label})</span>
            )}
          </h2>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <Select value={depth} onValueChange={setDepth}>
          <SelectTrigger className="h-6 min-w-0 gap-1 border-0 bg-transparent px-1.5 py-0 text-xs font-medium text-muted-foreground shadow-none cursor-pointer rounded hover:bg-muted hover:text-foreground transition-colors">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" position="popper">
            {depthOptions.map((d) => (
              <SelectItem
                key={d}
                value={d}
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Select
            value={amountDenom}
            onValueChange={(v) => setAmountDenom(v as "base" | "quote")}
          >
            <SelectTrigger className="h-6 min-w-0 gap-1 border-0 bg-transparent px-1.5 py-0 text-xs font-medium text-muted-foreground shadow-none cursor-pointer rounded hover:bg-muted hover:text-foreground transition-colors">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              <SelectItem
                value="base"
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                {baseSymbol}
              </SelectItem>
              <SelectItem
                value="quote"
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                {quoteSymbol}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
          >
            <SelectTrigger className="h-6 min-w-0 gap-1 border-0 bg-transparent px-1.5 py-0 text-xs font-medium text-muted-foreground shadow-none cursor-pointer rounded hover:bg-muted hover:text-foreground transition-colors">
              <div className="flex items-center gap-1">
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent align="end" position="popper">
              <SelectItem
                value="all"
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                <div className="flex items-center gap-2">
                  <ViewModeIcon mode="all" />
                  All
                </div>
              </SelectItem>
              <SelectItem
                value="asks"
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                <div className="flex items-center gap-2">
                  <ViewModeIcon mode="asks" />
                  Asks
                </div>
              </SelectItem>
              <SelectItem
                value="bids"
                className="text-xs cursor-pointer hover:bg-muted transition-colors rounded"
              >
                <div className="flex items-center gap-2">
                  <ViewModeIcon mode="bids" />
                  Bids
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className="flex-1 overflow-hidden px-2 py-1 bg-muted/20 grid"
        style={{
          gridTemplateRows:
            viewMode === "asks"
              ? "auto 1fr auto"
              : viewMode === "bids"
                ? "auto auto 1fr"
                : "auto 1fr auto 1fr",
        }}
      >
        {/* Header */}
        <div className="grid grid-cols-3 gap-2 px-2 text-xs text-muted-foreground mb-1">
          <div className="text-left">Price(USDT)</div>
          <div className="text-right">
            Size ({amountDenom === "base" ? baseSymbol : quoteSymbol})
          </div>
          <div className="text-right">Total</div>
        </div>

        {/* Asks — justify-end so rows stick to bottom */}
        {viewMode !== "bids" && (
          <div
            ref={sideRef}
            className="min-h-0 flex flex-col justify-end overflow-hidden"
          >
            {showLoading && <SkeletonRows count={maxRows} />}
            <div className="flex flex-col gap-px">
              {(() => {
                // Cumulative from spread (bottom) outward (top)
                // Use max of both sides so neither always reaches 100%
                const maxCum =
                  Math.max(
                    cumulativeAsks[0] || 0,
                    cumulativeBids[cumulativeBids.length - 1] || 0
                  ) || 1
                return asks.map((ask, i) => {
                  const barRatio = (cumulativeAsks[i] / maxCum) * 100
                  return (
                    <div
                      key={`ask-${i}`}
                      className="relative h-[22px] px-2 cursor-pointer hover:bg-destructive/10 transition-colors"
                      onClick={() => setSelectedPrice(ask.price)}
                    >
                      <div
                        className="absolute left-0 top-0 h-full bg-destructive/15 transition-[width] duration-300 ease-out"
                        style={{ width: `${barRatio}%` }}
                      />
                      <div
                        className="absolute left-0 top-0 h-full bg-destructive/25 transition-[width] duration-300 ease-out"
                        style={{
                          width: `${((amountDenom === "quote" ? parseFloat(ask.size) * parseFloat(ask.price) : parseFloat(ask.size)) / maxCum) * 100}%`,
                        }}
                      />
                      <div className="relative grid grid-cols-3 gap-2 text-xs font-mono z-10 h-full items-center">
                        <div className="text-left text-destructive">
                          {formatPrice(ask.price)}
                        </div>
                        <div className="text-right text-foreground">
                          {formatAmount(ask.size, ask.price)}
                        </div>
                        <div className="text-right text-muted-foreground">
                          {cumulativeAsks[i]?.toFixed(4)}
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}

        {/* Current Price — fixed center. When the book is empty on both
            sides, replace the "0.00 / Last Price" placeholder with a
            short explainer so the user understands the market simply
            has no quotes yet (common on staging or freshly-registered
            markets) instead of suspecting a broken UI. */}
        {showLoading ? (
          <div className="my-0.5 flex flex-col items-center gap-1.5 rounded bg-muted/20 px-2 py-2.5 shrink-0">
            <div className="h-3.5 w-20 animate-pulse rounded bg-muted/50" />
            <div className="h-2 w-14 animate-pulse rounded bg-muted/30" />
          </div>
        ) : bids.length === 0 && asks.length === 0 ? (
          <div className="my-0.5 rounded bg-muted/30 px-2 py-2 text-center shrink-0">
            <div className="text-xs font-medium text-foreground">
              No active orders
            </div>
            <div className="text-[10px] leading-snug text-muted-foreground">
              The book fills in once a maker quotes this market.
            </div>
          </div>
        ) : (
          <div className="my-0.5 rounded bg-success/10 px-2 py-1 text-center shrink-0">
            <div className="text-sm font-bold text-success font-mono">
              {bids[0] ? formatPrice(bids[0].price) : "0.00"}
            </div>
            <div className="text-[10px] text-muted-foreground">Last Price</div>
          </div>
        )}

        {/* Bids — justify-start so rows stick to top */}
        {viewMode !== "asks" && (
          <div
            ref={viewMode === "bids" ? sideRef : undefined}
            className="min-h-0 overflow-hidden"
          >
            {showLoading && <SkeletonRows count={maxRows} />}
            <div className="flex flex-col gap-px">
              {(() => {
                // Cumulative from spread (top) outward (bottom)
                // Use max of both sides so neither always reaches 100%
                const maxCum =
                  Math.max(
                    cumulativeAsks[0] || 0,
                    cumulativeBids[cumulativeBids.length - 1] || 0
                  ) || 1
                return bids.map((bid, i) => {
                  const barRatio = (cumulativeBids[i] / maxCum) * 100
                  return (
                    <div
                      key={`bid-${i}`}
                      className="relative h-[22px] px-2 cursor-pointer hover:bg-success/10 transition-colors"
                      onClick={() => setSelectedPrice(bid.price)}
                    >
                      <div
                        className="absolute left-0 top-0 h-full bg-success/15 transition-[width] duration-300 ease-out"
                        style={{ width: `${barRatio}%` }}
                      />
                      <div
                        className="absolute left-0 top-0 h-full bg-success/25 transition-[width] duration-300 ease-out"
                        style={{
                          width: `${((amountDenom === "quote" ? parseFloat(bid.size) * parseFloat(bid.price) : parseFloat(bid.size)) / maxCum) * 100}%`,
                        }}
                      />
                      <div className="relative grid grid-cols-3 gap-2 text-xs font-mono z-10 h-full items-center">
                        <div className="text-left text-success">
                          {formatPrice(bid.price)}
                        </div>
                        <div className="text-right text-foreground">
                          {formatAmount(bid.size, bid.price)}
                        </div>
                        <div className="text-right text-muted-foreground">
                          {cumulativeBids[i]?.toFixed(4)}
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Placeholder rows shown while the orderbook is still loading (before the
 *  first snapshot arrives), so we never flash the "No active orders" empty
 *  message during the initial load. Mirrors the real row grid.
 *
 *  Exported so the page-level `TradeSkeleton` reuses the *same* rows for its
 *  orderbook column — keeping the network-load skeleton and the orderbook's
 *  own loading skeleton visually identical (no style drift between the two). */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-px">
      {Array.from({ length: Math.max(1, count) }).map((_, i) => (
        <div
          key={i}
          className="grid h-[22px] grid-cols-3 items-center gap-2 px-2"
        >
          <div className="h-2.5 w-12 animate-pulse rounded bg-muted/50" />
          <div className="h-2.5 w-14 animate-pulse justify-self-end rounded bg-muted/40" />
          <div className="h-2.5 w-10 animate-pulse justify-self-end rounded bg-muted/30" />
        </div>
      ))}
    </div>
  )
}

function ViewModeIcon({ mode }: { mode: ViewMode }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className="size-3">
      <rect
        width="12"
        height="5"
        rx="1"
        className={mode === "bids" ? "fill-success" : "fill-destructive"}
      />
      <rect
        y="7"
        width="12"
        height="5"
        rx="1"
        className={mode === "asks" ? "fill-destructive" : "fill-success"}
      />
    </svg>
  )
}

// ── Default export: WS-powered OrderBook (기존과 동일한 인터페이스) ──

export function OrderBook({
  showHeader = true,
}: { showHeader?: boolean } = {}) {
  const pair = useSelectedPair()
  const orderbook = useOrderbook(pair.id)
  return <OrderBookView data={orderbook.data} showHeader={showHeader} />
}
