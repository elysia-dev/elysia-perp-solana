"use client"

// Candlestick + volume chart built on the open-source lightweight-charts
// library (Apache-2.0). Replaces the proprietary TradingView charting_library.
// Data comes from Elysia's candle-api (REST history) plus the shared WebSocket
// (realtime in-progress candle); position/liquidation/order/mark-price levels
// are drawn as horizontal price lines.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
} from "lightweight-charts"
import {
  fetchCandles,
  resolutionToInterval,
  subscribeRealtimeCandles,
  RESOLUTION_OPTIONS,
  type Candle,
  type ResolutionValue,
} from "@/lib/chart/datafeed"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { useMarketStore } from "@/lib/stores/useMarketStore"
import {
  useMarkPriceStore,
  selectMarkPriceData,
} from "@/lib/stores/useMarkPriceStore"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import type { Pair } from "@/types"

const LONG_COLOR = "#0dbb92"
const SHORT_COLOR = "#f15044"
const LIQ_COLOR = "#f5a623"
const ORDER_COLOR = "#0086fc"
const MARK_COLOR = "#b2b5be"
const VOL_UP = "rgba(13,187,146,0.45)"
const VOL_DOWN = "rgba(241,80,68,0.45)"

const HISTORY_LIMIT = 500

interface Props {
  indexToken: Pair
  className?: string
}

export function AdvancedChart({ indexToken, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const priceLinesRef = useRef<IPriceLine[]>([])

  const [resolution, setResolution] = useState<ResolutionValue>("15")
  const [loadError, setLoadError] = useState<string | null>(null)

  const marketName = indexToken.name
  const marketId = indexToken.id
  const marketsLoaded = useMarketStore((st) => st.marketsLoaded)
  const { subscribe } = useWebSocket()

  // Price precision from the market's quote scale (quote_scale_k = 10^decimals).
  const priceDecimals = useMemo(() => {
    const k = indexToken.quote_scale_k || 100
    return Math.max(0, Math.round(Math.log10(k)))
  }, [indexToken.quote_scale_k])

  const positions = usePositionsList()
  const { data: openOrdersData } = useOpenPerpOrders()
  const openOrders = openOrdersData?.orders
  const markData = useMarkPriceStore(selectMarkPriceData(marketName))
  const markPrice = markData?.mark_price ? parseFloat(markData.mark_price) : 0

  // 1) Create the chart once. Series + resize observer live for the mount.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#b2b5be",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.07)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.12)",
        // Reserve the bottom ~26% for the volume pane so candles never draw
        // over the volume bars (volume uses the bottom 20%).
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.12)",
        timeVisible: true,
        secondsVisible: false,
        // Narrower bars = zoomed-out view (fitContent made few bars look fat).
        barSpacing: 9,
        rightOffset: 4,
      },
    })
    chartRef.current = chart

    const candle = chart.addCandlestickSeries({
      upColor: LONG_COLOR,
      downColor: SHORT_COLOR,
      borderUpColor: LONG_COLOR,
      borderDownColor: SHORT_COLOR,
      wickUpColor: LONG_COLOR,
      wickDownColor: SHORT_COLOR,
    })
    candleRef.current = candle

    const volume = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    })
    // Pin the volume histogram to the bottom ~20% of the pane.
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volumeRef.current = volume

    const resize = () => {
      chart.resize(container.clientWidth, container.clientHeight)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      priceLinesRef.current = []
    }
  }, [])

  // Keep the candle price format in sync with the market's precision.
  useEffect(() => {
    candleRef.current?.applyOptions({
      priceFormat: {
        type: "price",
        precision: priceDecimals,
        minMove: 1 / 10 ** priceDecimals,
      },
    })
  }, [priceDecimals])

  // 2) Load history + subscribe to realtime whenever market/resolution changes.
  useEffect(() => {
    if (!marketsLoaded) return
    const candle = candleRef.current
    const volume = volumeRef.current
    if (!candle || !volume) return

    let cancelled = false
    const interval = resolutionToInterval(resolution)

    const applyVolume = (c: Candle) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? VOL_UP : VOL_DOWN,
    })

    const load = async () => {
      setLoadError(null)
      let bars = await fetchCandles(marketName, interval, HISTORY_LIMIT)
      for (let attempt = 0; bars === null && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 400))
        bars = await fetchCandles(marketName, interval, HISTORY_LIMIT)
      }
      if (cancelled) return
      if (bars === null) {
        setLoadError("Chart data is temporarily unavailable.")
        return
      }
      candle.setData(
        bars.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      )
      volume.setData(bars.map(applyVolume))
      // Keep the configured barSpacing (zoom level) and anchor to the latest
      // bar, instead of fitContent() which stretches all bars to fill the width.
      chartRef.current?.timeScale().scrollToRealTime()
    }

    load()

    // Realtime: update the in-progress bar (WS carries the live candle).
    const unsub = subscribeRealtimeCandles(
      { subscribe, resolveMarketId: () => marketId },
      marketName,
      marketName,
      interval,
      (c) => {
        if (cancelled) return
        candle.update({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })
        volume.update(applyVolume(c))
      }
    )

    // Backfill on tab refocus (the WS may have missed bars while hidden).
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", load)

    return () => {
      cancelled = true
      unsub()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", load)
    }
  }, [marketName, marketId, resolution, marketsLoaded, subscribe])

  // 3) Draw mark-price / position / liquidation / open-order price lines.
  useEffect(() => {
    const candle = candleRef.current
    if (!candle) return

    const lines: IPriceLine[] = []
    const add = (price: number, color: string, title: string, dashed = true) => {
      if (!Number.isFinite(price) || price <= 0) return
      lines.push(
        candle.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title,
        })
      )
    }

    if (markPrice > 0) add(markPrice, MARK_COLOR, "Mark")

    const position = positions.find((p) => p.market === marketName)
    if (position) {
      const isLong = position.side === "Long"
      add(
        parseFloat(position.entry_price),
        isLong ? LONG_COLOR : SHORT_COLOR,
        `Entry ${position.side}`,
        false
      )
      add(parseFloat(position.liquidation_price), LIQ_COLOR, "Liq.")
    }

    for (const order of openOrders ?? []) {
      if (order.market !== marketName) continue
      add(parseFloat(order.price), ORDER_COLOR, `${order.side} ${order.order_type}`)
    }

    return () => {
      for (const line of lines) {
        try {
          candle.removePriceLine(line)
        } catch {
          /* series may be gone with the chart */
        }
      }
    }
  }, [marketName, markPrice, positions, openOrders])

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Interval switcher */}
      <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-md bg-[#141414]/80 p-0.5 backdrop-blur">
        {RESOLUTION_OPTIONS.map((opt) => (
          <button
            key={opt.resolution}
            onClick={() => setResolution(opt.resolution as ResolutionValue)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              resolution === opt.resolution
                ? "bg-[#2a2a2a] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 px-4 text-center">
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      )}
    </div>
  )
}
