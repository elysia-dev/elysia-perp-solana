"use client"

import { useEffect, useRef, useState } from "react"
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  ColorType,
  TickMarkType,
} from "lightweight-charts"
import { Pair } from "@/types"
import { type PerpOrder, sideToIsAsk } from "@/types/perp"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import { usePerpOrderHistory } from "@/lib/hooks/usePerpOrderHistory"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { useCancelPerpOrder } from "@/lib/hooks/useCancelPerpOrder"
import { useMarkPriceStore } from "@/lib/stores"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useClosePosition } from "@/lib/hooks/useClosePosition"
import { positionLiquidationPrice } from "@/lib/utils/liquidation"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"

interface TradingViewChartProps {
  indexToken: Pair
  interval?: string
  /** "ws" = WS + REST fallback (default), "rest" = REST polling only */
  dataSource?: "ws" | "rest"
}

const SUPPORTED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const
const DEFAULT_DISPLAYED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"]

function toBackendInterval(interval: string): string {
  if ((SUPPORTED_INTERVALS as readonly string[]).includes(interval))
    return interval
  const mapping: Record<string, string> = {
    "3m": "5m",
    "30m": "15m",
    "2h": "1h",
    "6h": "4h",
    "8h": "4h",
    "12h": "4h",
    "1w": "1d",
    "3d": "1d",
    "1M": "1d",
  }
  return mapping[interval] || "15m"
}

interface CandleServerResponse {
  market: string
  interval: string
  candles: Array<{
    t: number
    o: string
    h: string
    l: string
    c: string
    v: string
    qv: string
    n: number
  }>
}

interface ParsedCandle {
  time: Time
  open: number
  high: number
  low: number
  close: number
  volume: number
}

// WS candle message types
interface WsCandleMessage {
  type: "subscribed/candle" | "update/candle" | string
  channel: string
  data?: {
    t: number // milliseconds
    o: string
    h: string
    l: string
    c: string
    v: string
    V: string
    n: number
    closed: boolean
  }
}

// Candle servers disagree on how they key a perp market, and we can't tell
// which generation a given deploy's `NEXT_PUBLIC_CANDLE_API_URL` points at:
//   - newer (e.g. staging): the BASE perp symbol "BTC-PERP", which is
//     collateral-independent — a BTC perp has the same price feed whether it
//     settles in EL, ARB, USDT, …
//   - older (e.g. dev / v0): the FULL in-app market name "BTC-PERP-EL",
//     "ETH-PERP-ARB", carrying the collateral suffix (multi-collateral,
//     ELP-133).
// Sending the wrong form returns `400 Unknown market`, which renders as the
// empty "Chart data unavailable" state even when candles exist. So we try one
// form, fall back to the other on a non-OK response, and cache the winning
// form for the rest of the session (it's the same server throughout). When the
// older servers are upgraded to the base-symbol scheme this keeps working with
// no code change.

/** Strip the collateral suffix: "BTC-PERP-EL" → "BTC-PERP". */
function toBaseSymbol(market: string): string {
  const marker = "-PERP"
  const idx = market.indexOf(marker)
  return idx === -1 ? market : market.slice(0, idx + marker.length)
}

type CandleSymbolFormat = "base" | "full"

/** The market-key form the active candle server accepts, learned at runtime. */
let candleSymbolFormat: CandleSymbolFormat | null = null

function candleSymbol(market: string, format: CandleSymbolFormat): string {
  return format === "base" ? toBaseSymbol(market) : market
}

async function fetchCandles(
  market: string,
  interval: string,
  limit: number = 500,
  startTime?: number,
  endTime?: number
): Promise<{
  data: CandlestickData[]
  volumeData: HistogramData[]
  latest: {
    open: number
    high: number
    low: number
    close: number
    volume: number
  } | null
  allData: ParsedCandle[]
}> {
  const empty = { data: [], volumeData: [], latest: null, allData: [] }
  const params = new URLSearchParams({ interval, limit: String(limit) })
  if (startTime) params.set("startTime", String(startTime))
  if (endTime) params.set("endTime", String(endTime))

  // Try the cached-working form first, then the other. Default order probes
  // the base symbol first (the forward-looking convention).
  const order: CandleSymbolFormat[] =
    candleSymbolFormat === "full" ? ["full", "base"] : ["base", "full"]

  for (let i = 0; i < order.length; i++) {
    const format = order[i]
    const isLast = i === order.length - 1
    try {
      const response = await fetch(
        `/candle-api/markets/${encodeURIComponent(
          candleSymbol(market, format)
        )}/candles?${params}`,
        { cache: "no-store" }
      )
      // A non-OK response (e.g. `400 Unknown market`) means this server keys
      // markets by the other form — fall back unless we're out of candidates.
      if (!response.ok) {
        if (!isLast) continue
        return empty
      }
      // A 200 means the server recognises this form (even with zero candles,
      // i.e. a valid market with no trades yet). Remember it so later calls
      // skip the probe.
      candleSymbolFormat = format

      const json: CandleServerResponse = await response.json()
      const candles = json.candles || []
      if (candles.length === 0) return empty

      const allData: ParsedCandle[] = candles.map((c) => ({
        time: c.t as Time,
        open: parseFloat(c.o),
        high: parseFloat(c.h),
        low: parseFloat(c.l),
        close: parseFloat(c.c),
        volume: parseFloat(c.v),
      }))

      const data: CandlestickData[] = allData.map((d) => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))

      const volumeData: HistogramData[] = allData.map((d) => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? "#26a69a80" : "#ef535080",
      }))

      const last = allData[allData.length - 1]
      return {
        data,
        volumeData,
        latest: {
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume,
        },
        allData,
      }
    } catch (error) {
      // Network/parse failure — not a symbol-form signal, so don't burn the
      // fallback on it; preserve the original "return empty on error".
      console.error("Error fetching candle data:", error)
      return empty
    }
  }
  return empty
}

function useLocalStorageState<T>(
  key: string,
  defaultValue: T
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const setStoredValue = (v: T | ((prev: T) => T)) => {
    setValue((prev: T) => {
      const next = typeof v === "function" ? (v as (prev: T) => T)(prev) : v
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* */
      }
      return next
    })
  }

  return [value, setStoredValue]
}

// ── Timezone support ──

interface TimezoneOption {
  label: string
  tz: string // IANA timezone identifier
}

const TIMEZONE_OPTIONS: TimezoneOption[] = [
  // UTC first
  { label: "UTC", tz: "UTC" },
  // UTC- (descending offset: -11 → -3)
  { label: "(UTC-11) Midway Island", tz: "Pacific/Midway" },
  { label: "(UTC-10) Honolulu", tz: "Pacific/Honolulu" },
  { label: "(UTC-9) Alaska", tz: "America/Anchorage" },
  { label: "(UTC-8) Juneau", tz: "America/Juneau" },
  { label: "(UTC-8) Los Angeles", tz: "America/Los_Angeles" },
  { label: "(UTC-8) Vancouver", tz: "America/Vancouver" },
  { label: "(UTC-7) Phoenix", tz: "America/Phoenix" },
  { label: "(UTC-7) Denver", tz: "America/Denver" },
  { label: "(UTC-6) Mexico City", tz: "America/Mexico_City" },
  { label: "(UTC-6) Chicago", tz: "America/Chicago" },
  { label: "(UTC-6) El Salvador", tz: "America/El_Salvador" },
  { label: "(UTC-5) Bogota", tz: "America/Bogota" },
  { label: "(UTC-5) Lima", tz: "America/Lima" },
  { label: "(UTC-5) New York", tz: "America/New_York" },
  { label: "(UTC-5) Toronto", tz: "America/Toronto" },
  { label: "(UTC-4) Caracas", tz: "America/Caracas" },
  { label: "(UTC-4) Santiago", tz: "America/Santiago" },
  { label: "(UTC-3) São Paulo", tz: "America/Sao_Paulo" },
  { label: "(UTC-3) Buenos Aires", tz: "America/Argentina/Buenos_Aires" },
  // UTC+0 ~ UTC+13
  { label: "(UTC+0) London", tz: "Europe/London" },
  { label: "(UTC+0) Reykjavik", tz: "Atlantic/Reykjavik" },
  { label: "(UTC+1) Lagos", tz: "Africa/Lagos" },
  { label: "(UTC+1) Berlin", tz: "Europe/Berlin" },
  { label: "(UTC+1) Madrid", tz: "Europe/Madrid" },
  { label: "(UTC+1) Paris", tz: "Europe/Paris" },
  { label: "(UTC+1) Rome", tz: "Europe/Rome" },
  { label: "(UTC+1) Warsaw", tz: "Europe/Warsaw" },
  { label: "(UTC+1) Zurich", tz: "Europe/Zurich" },
  { label: "(UTC+2) Helsinki", tz: "Europe/Helsinki" },
  { label: "(UTC+2) Bucharest", tz: "Europe/Bucharest" },
  { label: "(UTC+2) Athens", tz: "Europe/Athens" },
  { label: "(UTC+2) Cairo", tz: "Africa/Cairo" },
  { label: "(UTC+2) Johannesburg", tz: "Africa/Johannesburg" },
  { label: "(UTC+3) Istanbul", tz: "Europe/Istanbul" },
  { label: "(UTC+3) Moscow", tz: "Europe/Moscow" },
  { label: "(UTC+3) Riyadh", tz: "Asia/Riyadh" },
  { label: "(UTC+3) Kuwait", tz: "Asia/Kuwait" },
  { label: "(UTC+3) Bahrain", tz: "Asia/Bahrain" },
  { label: "(UTC+3:30) Tehran", tz: "Asia/Tehran" },
  { label: "(UTC+4) Dubai", tz: "Asia/Dubai" },
  { label: "(UTC+4) Muscat", tz: "Asia/Muscat" },
  { label: "(UTC+5) Karachi", tz: "Asia/Karachi" },
  { label: "(UTC+5) Yekaterinburg", tz: "Asia/Yekaterinburg" },
  { label: "(UTC+5:30) Kolkata", tz: "Asia/Kolkata" },
  { label: "(UTC+5:45) Kathmandu", tz: "Asia/Kathmandu" },
  { label: "(UTC+6) Almaty", tz: "Asia/Almaty" },
  { label: "(UTC+6) Dhaka", tz: "Asia/Dhaka" },
  { label: "(UTC+7) Bangkok", tz: "Asia/Bangkok" },
  { label: "(UTC+7) Ho Chi Minh", tz: "Asia/Ho_Chi_Minh" },
  { label: "(UTC+7) Jakarta", tz: "Asia/Jakarta" },
  { label: "(UTC+8) Shanghai", tz: "Asia/Shanghai" },
  { label: "(UTC+8) Hong Kong", tz: "Asia/Hong_Kong" },
  { label: "(UTC+8) Singapore", tz: "Asia/Singapore" },
  { label: "(UTC+8) Taipei", tz: "Asia/Taipei" },
  { label: "(UTC+8) Perth", tz: "Australia/Perth" },
  { label: "(UTC+9) Seoul", tz: "Asia/Seoul" },
  { label: "(UTC+9) Tokyo", tz: "Asia/Tokyo" },
  { label: "(UTC+9:30) Adelaide", tz: "Australia/Adelaide" },
  { label: "(UTC+9:30) Darwin", tz: "Australia/Darwin" },
  { label: "(UTC+10) Brisbane", tz: "Australia/Brisbane" },
  { label: "(UTC+10) Sydney", tz: "Australia/Sydney" },
  { label: "(UTC+12) Auckland", tz: "Pacific/Auckland" },
  { label: "(UTC+12) Fiji", tz: "Pacific/Fiji" },
  { label: "(UTC+13) Tongatapu", tz: "Pacific/Tongatapu" },
]

/** Get short UTC offset label for a timezone, e.g. "UTC+9" */
function getUtcOffsetLabel(tz: string): string {
  if (tz === "UTC") return "UTC"
  const now = new Date()
  // Get offset by comparing formatted times
  const utcStr = now.toLocaleString("en-US", {
    timeZone: "UTC",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
  const tzStr = now.toLocaleString("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  })
  const [utcH, utcM] = utcStr.split(":").map(Number)
  const [tzH, tzM] = tzStr.split(":").map(Number)
  let diffMin = tzH * 60 + tzM - (utcH * 60 + utcM)
  // Handle day boundary
  if (diffMin > 720) diffMin -= 1440
  if (diffMin < -720) diffMin += 1440
  const h = Math.floor(Math.abs(diffMin) / 60)
  const m = Math.abs(diffMin) % 60
  const sign = diffMin >= 0 ? "+" : "-"
  return m === 0
    ? `UTC${sign}${h}`
    : `UTC${sign}${h}:${String(m).padStart(2, "0")}`
}

/** Format a UTC epoch‑seconds timestamp for crosshair tooltip */
function formatTimeForTz(utcSeconds: number, tz: string): string {
  const d = new Date(utcSeconds * 1000)
  return d.toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/** Format time‑axis tick marks — Binance/Lighter style:
 *  Year boundary (Jan 1) → "2025"
 *  Month boundary (1st)  → "APR", "MAR"
 *  Day                   → "28" (number only)
 *  Time                  → "18:40"
 */
function formatTickForTz(
  utcSeconds: number,
  tickType: TickMarkType,
  tz: string
): string {
  const d = new Date(utcSeconds * 1000)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""

  switch (tickType) {
    case TickMarkType.Year:
      return get("year")
    case TickMarkType.Month: {
      // Jan 1 → show year, otherwise just month abbreviation
      const day = parseInt(get("day"), 10)
      const month = get("month").toUpperCase()
      return day === 1 && month === "JAN" ? get("year") : month
    }
    case TickMarkType.DayOfMonth: {
      const day = parseInt(get("day"), 10)
      const month = get("month").toUpperCase()
      // 1st of month → "APR", "MAR" etc. Otherwise just the day number
      return day === 1 ? month : String(day)
    }
    case TickMarkType.Time:
      return `${get("hour")}:${get("minute")}`
    case TickMarkType.TimeWithSeconds:
      return `${get("hour")}:${get("minute")}:${get("second")}`
    default:
      return `${get("hour")}:${get("minute")}`
  }
}

function isOrderBuy(order: PerpOrder): boolean {
  return order.side === "Long"
}

function getIntervalSeconds(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3_600,
    "4h": 14_400,
    "1d": 86_400,
  }
  return map[interval] || 900
}

function getIntervalMs(interval: string): number {
  return getIntervalSeconds(interval) * 1000
}

/** Generate whitespace data points for future timestamps so the time axis shows future labels + grid */
function generateFutureWhitespace(
  lastTime: number,
  interval: string,
  count: number
): { time: Time }[] {
  const step = getIntervalSeconds(interval)
  const result: { time: Time }[] = []
  for (let i = 1; i <= count; i++) {
    result.push({ time: (lastTime + step * i) as Time })
  }
  return result
}

/**
 * Subscribe to chart viewport changes and update label Y positions.
 * Returns an unsubscribe function. Much cheaper than a perpetual RAF loop.
 */
function trackLabelPositions(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  container: HTMLDivElement,
  entries: { el: HTMLDivElement; price: number; display?: string }[]
): () => void {
  const update = () => {
    const chartHeight = container.clientHeight
    for (const { el, price, display } of entries) {
      const y = series.priceToCoordinate(price)
      if (y === null || y < 0 || y > chartHeight) {
        el.style.display = "none"
      } else {
        el.style.display = display || "flex"
        el.style.top = `${y}px`
      }
    }
  }
  update()
  chart.timeScale().subscribeVisibleLogicalRangeChange(update)
  chart.subscribeCrosshairMove(update)
  return () => {
    chart.timeScale().unsubscribeVisibleLogicalRangeChange(update)
    chart.unsubscribeCrosshairMove(update)
  }
}

/** Create a custom dashed line div (CSS gradient) for wider gap control */
function createDashedLine(
  color: string,
  dashLen = 2,
  gapLen = 6
): HTMLDivElement {
  const line = document.createElement("div")
  line.style.cssText = `
    position: absolute;
    left: 0;
    width: 100%;
    height: 1px;
    pointer-events: none;
    z-index: 4;
    transform: translateY(-0.5px);
    background: repeating-linear-gradient(to right, ${color} 0px, ${color} ${dashLen}px, transparent ${dashLen}px, transparent ${dashLen + gapLen}px);
  `
  return line
}

export default function TradingViewChart({
  indexToken,
  interval = "15m",
  dataSource = "ws",
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // OKX-style trade badges: B/S letters drawn INSIDE a colored badge as an
  // HTML overlay positioned via the chart's time/price → pixel coordinate API
  // (lightweight-charts markers can't render text inside the shape). Hovering
  // a badge shows the shared tooltip with the fill count + avg entry price.
  const markerTooltipRef = useRef<HTMLDivElement>(null)
  const badgeOverlayRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  const [currentInterval, setCurrentInterval] = useState(interval)
  const [displayedIntervals, setDisplayedIntervals] = useState<string[]>(
    DEFAULT_DISPLAYED_INTERVALS
  )
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const allCandleDataRef = useRef<ParsedCandle[]>([])
  const wsActiveRef = useRef(false)
  const [chartReady, setChartReady] = useState(false)
  // Tri-state instead of a plain boolean so we can render distinct
  // affordances for (a) "still fetching", (b) "got data, hide overlay",
  // and (c) "fetch came back empty / market not known to the OHLCV
  // indexer". Previously this was `dataLoaded: boolean`: an empty
  // response left it `false` forever, which rendered as a perpetual
  // "Loading chart..." spinner even though we'd already heard back and
  // there was nothing to wait for. That state is common on staging /
  // freshly-launched markets where the matching engine knows the symbol
  // but the candle indexer hasn't seen a trade yet.
  const [dataStatus, setDataStatus] = useState<
    "loading" | "data" | "unavailable"
  >("loading")
  const [selectedTz, setSelectedTz] = useLocalStorageState<string>(
    "chart-timezone",
    "UTC"
  )
  const [showTzMenu, setShowTzMenu] = useState(false)
  const [clockStr, setClockStr] = useState("")
  const tzMenuRef = useRef<HTMLDivElement>(null)
  const tzBtnRef = useRef<HTMLButtonElement>(null)
  const [isAutoScale, setIsAutoScale] = useState(true)

  const [ohlcData, setOhlcData] = useState<{
    open: number
    high: number
    low: number
    close: number
    volume: number
  } | null>(null)

  const [hoveredCandle, setHoveredCandle] = useState<{
    open: number
    high: number
    low: number
    close: number
    volume: number
  } | null>(null)

  const { subscribe, isConnected: wsConnected } = useWebSocket()
  // REST-only 모드에서는 WS를 사용하지 않음
  const isConnected = dataSource === "rest" ? false : wsConnected

  const { data: ordersData } = usePerpOrderHistory()
  const { data: openOrdersData } = useOpenPerpOrders()
  const cancelPerpOrder = useCancelPerpOrder()
  const closePosition = useClosePosition()
  // Only subscribe to the *current* market's mark price for the page-title
  // effect below. The close button used to read `markPrices` from this same
  // subscription, which forced this big chart component to re-render on
  // every tick of *any* symbol; we now read freshly via `getState()` inside
  // the click handler instead.
  const chartMarketSymbol = `${indexToken.base}-PERP`
  const titleMarkPrice = useMarkPriceStore((s) =>
    s.markPrices.get(chartMarketSymbol)
  )
  const [showMarkers, setShowMarkers] = useLocalStorageState(
    "chart-show-markers",
    true
  )
  // Trade badges (B/S) rendered as an HTML overlay (see `badgeOverlayRef`).
  const [tradeBadges, setTradeBadges] = useState<
    { id: string; time: number; price: number; isBuy: boolean; count: number }[]
  >([])
  const [showOrderLines, setShowOrderLines] = useLocalStorageState(
    "chart-show-order-lines",
    true
  )
  const [showLiquidationLine, setShowLiquidationLine] = useLocalStorageState(
    "chart-show-liq-line",
    true
  )
  const [showPositionLine, setShowPositionLine] = useLocalStorageState(
    "chart-show-position-line",
    true
  )
  const orderLinesRef = useRef<
    ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]
  >([])
  const orderLabelsRef = useRef<HTMLDivElement[]>([])
  const orderTrackRef = useRef<(() => void) | null>(null)
  const liqLineRef = useRef<ReturnType<
    ISeriesApi<"Candlestick">["createPriceLine"]
  > | null>(null)
  const liqLabelRef = useRef<HTMLDivElement | null>(null)
  const liqTrackRef = useRef<(() => void) | null>(null)
  const posLineRef = useRef<ReturnType<
    ISeriesApi<"Candlestick">["createPriceLine"]
  > | null>(null)
  const posLabelRef = useRef<HTMLDivElement | null>(null)
  const posTrackRef = useRef<(() => void) | null>(null)
  const positions = usePositionsList()
  const position = positions.find(
    (p) => p.market === indexToken.name && parseFloat(p.size) !== 0
  )

  const marketName = indexToken.name
  const marketId = indexToken.id
  const backendInterval = toBackendInterval(currentInterval)

  const oldestTimestampRef = useRef<number | null>(null)
  const isFetchingHistoryRef = useRef(false)
  const visibleBarsRef = useRef<number | null>(null)

  // Chart instance creation — only recreated when market changes
  useEffect(() => {
    if (!containerRef.current) return

    if (chartRef.current) {
      try {
        chartRef.current.remove()
      } catch {
        /* */
      }
      chartRef.current = null
      seriesRef.current = null
      volumeSeriesRef.current = null
    }
    containerRef.current.innerHTML = ""
    setDataStatus("loading")

    try {
      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "#111111" },
          textColor: "#d1d5db",
        },
        grid: {
          vertLines: { color: "#2a2a2a" },
          horzLines: { color: "#2a2a2a" },
        },
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 20,
        },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cs = (chart as any).addCandlestickSeries({
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      })
      chart.priceScale("right").applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vs = (chart as any).addHistogramSeries({
        color: "#26a69a80",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
      })
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.7, bottom: 0 },
        visible: false,
      })

      chartRef.current = chart
      seriesRef.current = cs
      volumeSeriesRef.current = vs

      // Crosshair hover
      chart.subscribeCrosshairMove((param) => {
        if (param.time && param.seriesData) {
          const cd = allCandleDataRef.current.find((d) => d.time === param.time)
          setHoveredCandle(cd ?? null)
        } else {
          setHoveredCandle(null)
        }
      })

      // Persist zoom level on every range change
      chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
        if (!logicalRange) return
        const bars = Math.round(logicalRange.to - logicalRange.from)
        if (bars > 0) visibleBarsRef.current = bars
      })

      const handleResize = () => {
        if (containerRef.current && chartRef.current === chart) {
          try {
            chart.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            })
          } catch {
            /* */
          }
        }
      }
      window.addEventListener("resize", handleResize)

      // Signal that chart is ready for data loading
      setChartReady(true)

      return () => {
        window.removeEventListener("resize", handleResize)
        try {
          chart.remove()
        } catch {
          /* */
        }
        chartRef.current = null
        seriesRef.current = null
        volumeSeriesRef.current = null
        setChartReady(false)
      }
    } catch (error) {
      console.error("Error creating chart:", error)
    }
  }, [marketName, indexToken.id])

  // Data loading — runs when interval changes, keeps chart instance alive
  useEffect(() => {
    const cs = seriesRef.current
    const vs = volumeSeriesRef.current
    const chart = chartRef.current
    if (!cs || !chart) return

    let isMounted = true
    allCandleDataRef.current = []
    oldestTimestampRef.current = null
    wsActiveRef.current = false
    isFetchingHistoryRef.current = false
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    // Save current zoom before clearing data
    const savedBars = visibleBarsRef.current

    fetchCandles(marketName, backendInterval, 500).then((result) => {
      if (!isMounted || !cs || chartRef.current !== chart) return
      // Empty result = the OHLCV backend has nothing for this symbol
      // (either it 400'd, or it 200'd with an empty `candles` array).
      // Flip to the "unavailable" overlay so the user sees an explicit
      // "data not yet available" message instead of an indefinite
      // spinner. We DON'T early-return without touching state — that
      // was the old bug.
      if (result.data.length === 0) {
        setDataStatus("unavailable")
        return
      }

      try {
        // Append future whitespace to volume series so the time axis shows upcoming labels + grid
        const lastTime = result.allData[result.allData.length - 1]
          .time as number
        const futureWs = generateFutureWhitespace(
          lastTime,
          backendInterval,
          300
        )
        cs.setData(result.data)
        if (vs) vs.setData([...result.volumeData, ...futureWs])
        allCandleDataRef.current = result.allData
        if (result.allData.length > 0) {
          oldestTimestampRef.current = result.allData[0].time as number
        }
        if (result.latest) setOhlcData(result.latest)

        // Restore zoom level
        if (savedBars && result.allData.length > 0) {
          const totalBars = result.allData.length
          chart.timeScale().setVisibleLogicalRange({
            from: totalBars - savedBars,
            to: totalBars + 20,
          })
        }
        setDataStatus("data")
      } catch (error) {
        console.warn("Error setting chart data:", error)
      }
    })

    // Infinite scroll
    const onRangeChange = (
      logicalRange: { from: number; to: number } | null
    ) => {
      if (!logicalRange || !isMounted || !cs || isFetchingHistoryRef.current)
        return
      if (logicalRange.from < 10 && oldestTimestampRef.current) {
        isFetchingHistoryRef.current = true
        const endTime = oldestTimestampRef.current - 1
        fetchCandles(marketName, backendInterval, 500, undefined, endTime)
          .then((older) => {
            if (!isMounted || older.data.length === 0 || !cs) {
              isFetchingHistoryRef.current = false
              return
            }
            const merged = [...older.allData, ...allCandleDataRef.current]
            merged.sort((a, b) => (a.time as number) - (b.time as number))
            const unique = merged.filter(
              (d, i, arr) => i === 0 || d.time !== arr[i - 1].time
            )
            allCandleDataRef.current = unique
            const lastT = unique[unique.length - 1].time as number
            const futureWs = generateFutureWhitespace(
              lastT,
              backendInterval,
              300
            )
            cs.setData(
              unique.map((d) => ({
                time: d.time,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
              }))
            )
            if (vs) {
              vs.setData([
                ...unique.map((d) => ({
                  time: d.time,
                  value: d.volume,
                  color: d.close >= d.open ? "#26a69a80" : "#ef535080",
                })),
                ...futureWs,
              ])
            }
            if (older.allData.length > 0) {
              oldestTimestampRef.current = older.allData[0].time as number
            }
            isFetchingHistoryRef.current = false
          })
          .catch(() => {
            isFetchingHistoryRef.current = false
          })
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange)

    return () => {
      isMounted = false
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange)
    }
  }, [marketName, backendInterval, chartReady])

  // Wake-from-sleep gap-fill — when the tab is backgrounded for a long
  // time (laptop closed, OS sleep, etc.) browsers throttle/pause our
  // 1-second polling interval and the WebSocket connection drops. On
  // resume the polling tick only asks for the latest 3 candles, which is
  // not enough to backfill a multi-hour sleep window, so the chart shows
  // visible gaps in the middle until the user manually refreshes.
  //
  // This effect listens for `visibilitychange` and refetches a large
  // batch (500 candles), then merges it with the existing in-memory
  // history (dedup by time, latest values win). We rebuild the series
  // data without touching `oldestTimestampRef` so the infinite-scroll
  // back-fill still knows how far we've already loaded, and we don't
  // call `setVisibleLogicalRange`, which means the user's current zoom
  // and pan position are preserved.
  useEffect(() => {
    const cs = seriesRef.current
    if (!cs) return

    let isCancelled = false
    let isRefetching = false

    const onVisible = async () => {
      if (document.visibilityState !== "visible") return
      if (isRefetching) return
      // Only run if we already have data — first-fetch is handled by
      // the data-loading effect above. Without any baseline there's
      // nothing to merge into, and the regular fetch would race with
      // this one and double-set the series.
      if (allCandleDataRef.current.length === 0) return

      isRefetching = true
      try {
        const result = await fetchCandles(marketName, backendInterval, 500)
        if (isCancelled || result.allData.length === 0) return
        const series = seriesRef.current
        if (!series) return

        // Merge: existing + fresh, sort by time, dedupe (fresh wins
        // because it comes later in the merged list — the same shape
        // the infinite-scroll merge uses).
        const merged = [...allCandleDataRef.current, ...result.allData]
        merged.sort((a, b) => (a.time as number) - (b.time as number))
        const unique: ParsedCandle[] = []
        for (const d of merged) {
          const last = unique[unique.length - 1]
          if (last && last.time === d.time) {
            unique[unique.length - 1] = d
          } else {
            unique.push(d)
          }
        }
        allCandleDataRef.current = unique

        const lastT = unique[unique.length - 1].time as number
        const futureWs = generateFutureWhitespace(lastT, backendInterval, 300)
        series.setData(
          unique.map((d) => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        )
        const vs = volumeSeriesRef.current
        if (vs) {
          vs.setData([
            ...unique.map((d) => ({
              time: d.time,
              value: d.volume,
              color: d.close >= d.open ? "#26a69a80" : "#ef535080",
            })),
            ...futureWs,
          ])
        }
        if (result.latest) setOhlcData(result.latest)
      } catch {
        /* ignore — next visibility flip or poll tick will retry */
      } finally {
        isRefetching = false
      }
    }

    document.addEventListener("visibilitychange", onVisible)
    return () => {
      isCancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [marketName, backendInterval, chartReady])

  // Real-time updates: WS if available, REST polling as fallback
  useEffect(() => {
    const cs = seriesRef.current
    if (!cs) return

    const updateCandle = (
      time: Time,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number
    ) => {
      try {
        cs.update({ time, open, high, low, close })
      } catch {
        /* series update failed — still update state below */
      }
      setOhlcData({ open, high, low, close, volume })
      const d: ParsedCandle = { time, open, high, low, close, volume }
      const idx = allCandleDataRef.current.findIndex((c) => c.time === time)
      if (idx >= 0) allCandleDataRef.current[idx] = d
      else allCandleDataRef.current.push(d)

      // Rebuild volume series with whitespace to avoid "Cannot update oldest data" error
      const vs = volumeSeriesRef.current
      if (vs) {
        const lastCandle =
          allCandleDataRef.current[allCandleDataRef.current.length - 1]
        const ws = lastCandle
          ? generateFutureWhitespace(
              lastCandle.time as number,
              backendInterval,
              300
            )
          : []
        vs.setData([
          ...allCandleDataRef.current.map((c) => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? "#26a69a80" : "#ef535080",
          })),
          ...ws,
        ])
      }
    }

    // Try WS first (skip if dataSource is "rest")
    if (isConnected && dataSource !== "rest") {
      const channel = `candle/${marketId}/${backendInterval}`

      const unsubscribe = subscribe(channel, (raw: unknown) => {
        const msg = raw as WsCandleMessage
        if (
          (msg.type === "subscribed/candle" || msg.type === "update/candle") &&
          msg.data
        ) {
          const d = msg.data
          const time = Math.floor(d.t / 1000) as Time
          updateCandle(
            time,
            parseFloat(d.o),
            parseFloat(d.h),
            parseFloat(d.l),
            parseFloat(d.c),
            parseFloat(d.v)
          )
          wsActiveRef.current = true

          // Stop polling once WS starts delivering data
          if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
          }
        }
      })

      // Start polling as fallback (will be stopped if WS delivers data)
      if (!pollingRef.current) {
        pollingRef.current = setInterval(async () => {
          if (wsActiveRef.current) return // WS is active, skip polling
          try {
            const update = await fetchCandles(marketName, backendInterval, 3)
            if (update.data.length === 0) return
            for (const candle of update.data) cs.update(candle)
            const volSeries = volumeSeriesRef.current
            if (volSeries) {
              for (const vol of update.volumeData) volSeries.update(vol)
            }
            if (update.latest) setOhlcData(update.latest)
            for (const d of update.allData) {
              const idx = allCandleDataRef.current.findIndex(
                (c) => c.time === d.time
              )
              if (idx >= 0) allCandleDataRef.current[idx] = d
              else allCandleDataRef.current.push(d)
            }
          } catch {
            /* ignore */
          }
        }, 1000)
      }

      return () => {
        unsubscribe()
        wsActiveRef.current = false
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    }

    // No WS — pure REST polling
    if (!pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        try {
          const update = await fetchCandles(marketName, backendInterval, 3)
          if (update.data.length === 0) return
          for (const candle of update.data) cs.update(candle)
          const volSeries = volumeSeriesRef.current
          if (volSeries) {
            for (const vol of update.volumeData) volSeries.update(vol)
          }
          if (update.latest) setOhlcData(update.latest)
          for (const d of update.allData) {
            const idx = allCandleDataRef.current.findIndex(
              (c) => c.time === d.time
            )
            if (idx >= 0) allCandleDataRef.current[idx] = d
            else allCandleDataRef.current.push(d)
          }
        } catch {
          /* ignore */
        }
      }, 1000)
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [
    marketName,
    marketId,
    backendInterval,
    isConnected,
    subscribe,
    dataSource,
    chartReady,
  ])

  // Trade badges (Buy/Sell) on chart — aggregated per (candle, side) like OKX.
  // Rendered as an HTML overlay (see `badgeOverlayRef`), not lightweight-charts
  // markers, so the B/S letter sits INSIDE the colored badge.
  //
  // Sourced from filled ORDERS, bucketed by `order.created_at`. NOTE: that is
  // the order *placement* time, so a limit order's badge lands on the candle
  // where it was placed, not where it filled. (Switching to /perp/trades fixes
  // the time but is capped at ~50 fills, which showed far fewer badges — see
  // git history; left on order history for broader coverage.)
  useEffect(() => {
    // Clear any legacy lightweight-charts markers from earlier builds.
    seriesRef.current?.setMarkers([])

    if (!showMarkers) {
      setTradeBadges([])
      return
    }
    // Any order with a non-zero fill — covers fully filled, still-resting
    // partials, and IOC/cancelled orders that filled some before cancelling.
    // Filtering on status === "filled" would drop partial/cancelled fills.
    // Engine-written "Liquidation" close orders are excluded: a forced
    // close is not a user trade, so it must not paint a B/S badge. (ADL
    // never writes an order row — trades only — so it can't appear here.)
    const filledOrders = (ordersData?.orders ?? []).filter(
      (o) =>
        o.market === marketName &&
        parseFloat(o.filled_base_amount) > 0 &&
        o.order_type !== "Liquidation"
    )
    if (filledOrders.length === 0) {
      setTradeBadges([])
      return
    }

    const intervalMs = getIntervalMs(backendInterval)

    // Aggregate per (candle, side): count + size-weighted avg price.
    type Agg = { count: number; sizeSum: number; notionalSum: number }
    const groups = new Map<string, Agg>() // key `${candleTimeSec}:${B|S}`
    for (const order of filledOrders) {
      const orderMs = new Date(order.created_at).getTime()
      const time = Math.floor(orderMs / intervalMs) * (intervalMs / 1000)
      const isBuy = isOrderBuy(order)
      const key = `${time}:${isBuy ? "B" : "S"}`
      const size = parseFloat(order.filled_base_amount) || 0
      const price = parseFloat(order.price) || 0
      const g = groups.get(key) ?? { count: 0, sizeSum: 0, notionalSum: 0 }
      g.count += 1
      g.sizeSum += size
      g.notionalSum += size * price
      groups.set(key, g)
    }

    const badges = Array.from(groups.entries()).map(([key, g]) => {
      const [timeStr, sideStr] = key.split(":")
      return {
        id: key,
        time: Number(timeStr),
        price: g.sizeSum > 0 ? g.notionalSum / g.sizeSum : 0,
        isBuy: sideStr === "B",
        count: g.count,
      }
    })
    setTradeBadges(badges)
  }, [ordersData, marketName, backendInterval, showMarkers])

  // Position the trade badges via the chart's coordinate API and keep them
  // pinned as the user pans/zooms/resizes (same pattern as the price labels).
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    const overlay = badgeOverlayRef.current
    if (!chart || !series || !overlay) return

    const GAP = 16 // px between the badge centre and the candle high/low
    const position = () => {
      const w = overlay.clientWidth
      const h = overlay.clientHeight
      const ts = chart.timeScale()
      const candles = allCandleDataRef.current
      overlay.querySelectorAll<HTMLElement>("[data-badge]").forEach((el) => {
        const time = Number(el.dataset.time)
        const isBuy = el.dataset.side === "B"
        const x = ts.timeToCoordinate(time as Time)
        // Anchor to the candle (buy below the low, sell above the high) like
        // OKX/TradingView — NOT at the raw fill price, which floats off the
        // candle when price has moved. Fall back to the fill price if the
        // candle for that time isn't loaded.
        const candle = candles.find((c) => c.time === time)
        let y: number | null
        if (candle) {
          const anchor = series.priceToCoordinate(
            isBuy ? candle.low : candle.high
          )
          y = anchor == null ? null : isBuy ? anchor + GAP : anchor - GAP
        } else {
          y = series.priceToCoordinate(Number(el.dataset.price))
        }
        if (x == null || y == null || x < 0 || x > w || y < 0 || y > h) {
          el.style.display = "none"
        } else {
          el.style.display = "flex"
          el.style.left = `${x}px`
          el.style.top = `${y}px`
        }
      })
    }
    position()
    const ts = chart.timeScale()
    ts.subscribeVisibleLogicalRangeChange(position)
    chart.subscribeCrosshairMove(position)
    window.addEventListener("resize", position)
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(position)
      chart.unsubscribeCrosshairMove(position)
      window.removeEventListener("resize", position)
    }
  }, [tradeBadges, chartReady])

  // Open order price lines on chart
  useEffect(() => {
    const cs = seriesRef.current
    const chart = chartRef.current
    const container = containerRef.current

    // Cleanup previous
    for (const line of orderLinesRef.current) {
      try {
        cs?.removePriceLine(line)
      } catch {
        /* already removed */
      }
    }
    orderLinesRef.current = []
    for (const el of orderLabelsRef.current) el.remove()
    orderLabelsRef.current = []
    orderTrackRef.current?.()
    orderTrackRef.current = null

    if (!cs || !chart || !container || !showOrderLines) return

    const orders = openOrdersData?.orders
    if (!orders || orders.length === 0) return

    const marketOrders = orders.filter((o) => o.market === marketName)
    if (marketOrders.length === 0) return

    const baseSymbol = indexToken.base.toUpperCase()
    const chartWrapper = container.parentElement
    if (!chartWrapper) return

    interface OrderLabel {
      el: HTMLDivElement
      price: number
      display?: string
    }
    const labelEntries: OrderLabel[] = []

    for (const order of marketOrders) {
      const price = parseFloat(order.price)
      if (isNaN(price) || price <= 0) continue

      const isBuy = isOrderBuy(order)
      const color = isBuy ? "#26a69a" : "#ef5350"

      // Price line — transparent line, axis label only
      const line = cs.createPriceLine({
        price,
        color: "transparent",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "",
        axisLabelColor: color,
        axisLabelTextColor: "#ffffff",
      })
      orderLinesRef.current.push(line)

      // Custom CSS dashed line with wide gaps
      const dashedLine = createDashedLine(color)
      chartWrapper.appendChild(dashedLine)
      orderLabelsRef.current.push(dashedLine)
      labelEntries.push({ el: dashedLine, price, display: "block" })

      // Custom HTML label
      const remaining = parseFloat(order.remaining_base_amount)
      const orderType = order.order_type
      const formattedPrice = price.toLocaleString()
      const orderId = order.id
      const orderMarket = order.market

      const label = document.createElement("div")
      label.style.cssText = `
        position: absolute;
        left: 25%;
        z-index: 10;
        display: flex;
        align-items: center;
        transform: translateY(-50%);
        font-size: 11px;
        white-space: nowrap;
        pointer-events: auto;
        background: #1a1a1a;
        border: 1px solid ${color}88;
        border-radius: 4px;
        padding: 2px 4px 2px 8px;
        gap: 8px;
      `

      // Text content: "Limit 68,502.5  |  0.00396 BTC"
      const textSpan = document.createElement("span")
      textSpan.style.cssText = `color: ${color}; font-weight: 500;`
      textSpan.textContent = `${orderType} ${formattedPrice}`

      const separator = document.createElement("span")
      separator.style.cssText = `color: ${color}44;`
      separator.textContent = "|"

      const sizeSpan = document.createElement("span")
      sizeSpan.style.cssText = `
        background: ${color};
        color: #fff;
        padding: 1px 6px;
        border-radius: 3px;
        font-weight: 500;
      `
      sizeSpan.textContent = `${remaining} ${baseSymbol}`

      // X (cancel) button
      const cancelBtn = document.createElement("button")
      cancelBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border: none;
        background: transparent;
        color: ${color};
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 0;
        opacity: 0.7;
        transition: opacity 0.15s;
      `
      cancelBtn.textContent = "✕"
      cancelBtn.onmouseenter = () => {
        cancelBtn.style.opacity = "1"
      }
      cancelBtn.onmouseleave = () => {
        cancelBtn.style.opacity = "0.7"
      }
      cancelBtn.onclick = (e) => {
        e.stopPropagation()
        cancelPerpOrder.mutate({ order_id: orderId, market: orderMarket })
      }

      label.appendChild(textSpan)
      label.appendChild(separator)
      label.appendChild(sizeSpan)
      label.appendChild(cancelBtn)
      chartWrapper.appendChild(label)
      orderLabelsRef.current.push(label)
      labelEntries.push({ el: label, price })
    }

    orderTrackRef.current = trackLabelPositions(
      chart,
      cs,
      container,
      labelEntries
    )

    return () => {
      orderTrackRef.current?.()
      orderTrackRef.current = null
      for (const el of orderLabelsRef.current) el.remove()
      orderLabelsRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOrdersData, marketName, showOrderLines, indexToken.base, chartReady])

  // Liquidation price line
  useEffect(() => {
    const cs = seriesRef.current
    const chart = chartRef.current
    const container = containerRef.current
    const chartWrapper = container?.parentElement

    // Cleanup previous
    if (liqLineRef.current && cs) {
      try {
        cs.removePriceLine(liqLineRef.current)
      } catch {
        /* */
      }
      liqLineRef.current = null
    }
    if (liqLabelRef.current) {
      liqLabelRef.current.remove()
      liqLabelRef.current = null
    }
    liqTrackRef.current?.()
    liqTrackRef.current = null

    if (
      !cs ||
      !chart ||
      !container ||
      !chartWrapper ||
      !showLiquidationLine ||
      !position
    )
      return

    const liqPrice = positionLiquidationPrice(position)
    if (isNaN(liqPrice) || liqPrice <= 0) return

    const color = "#f97316" // orange

    const line = cs.createPriceLine({
      price: liqPrice,
      color: "transparent",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "",
      axisLabelColor: color,
      axisLabelTextColor: "#ffffff",
    })
    liqLineRef.current = line

    // Custom CSS dashed line with wide gaps
    const dashedLine = createDashedLine(color)
    chartWrapper.appendChild(dashedLine)

    const label = document.createElement("div")
    label.style.cssText = `
      position: absolute;
      left: 25%;
      z-index: 10;
      display: flex;
      align-items: center;
      transform: translateY(-50%);
      font-size: 11px;
      white-space: nowrap;
      pointer-events: none;
      background: #1a1a1aee;
      border: 1px solid ${color}88;
      border-radius: 3px;
      padding: 3px 8px;
    `
    const textSpan = document.createElement("span")
    textSpan.style.cssText = `color: ${color}; font-weight: 600;`
    textSpan.textContent = "Liq. Price"

    label.appendChild(textSpan)
    chartWrapper.appendChild(label)
    liqLabelRef.current = label

    liqTrackRef.current = trackLabelPositions(chart, cs, container, [
      { el: dashedLine, price: liqPrice, display: "block" },
      { el: label, price: liqPrice },
    ])

    return () => {
      liqTrackRef.current?.()
      liqTrackRef.current = null
      dashedLine.remove()
      if (liqLabelRef.current) {
        liqLabelRef.current.remove()
        liqLabelRef.current = null
      }
    }
  }, [position, showLiquidationLine, chartReady])

  // Position entry price line
  useEffect(() => {
    const cs = seriesRef.current
    const chart = chartRef.current
    const container = containerRef.current
    const chartWrapper = container?.parentElement

    // Cleanup previous
    if (posLineRef.current && cs) {
      try {
        cs.removePriceLine(posLineRef.current)
      } catch {
        /* */
      }
      posLineRef.current = null
    }
    if (posLabelRef.current) {
      posLabelRef.current.remove()
      posLabelRef.current = null
    }
    posTrackRef.current?.()
    posTrackRef.current = null

    if (
      !cs ||
      !chart ||
      !container ||
      !chartWrapper ||
      !showPositionLine ||
      !position
    )
      return

    const entryPrice = parseFloat(position.entry_price)
    if (isNaN(entryPrice) || entryPrice <= 0) return

    const pnl = parseFloat(position.unrealized_pnl)
    const isProfit = pnl >= 0
    const color = isProfit ? "#26a69a" : "#ef5350"
    const posSize = parseFloat(position.size)
    const baseSymbol = indexToken.base.toUpperCase()

    const line = cs.createPriceLine({
      price: entryPrice,
      color: "transparent",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "",
      axisLabelColor: color,
      axisLabelTextColor: "#ffffff",
    })
    posLineRef.current = line

    // Custom CSS dashed line with wide gaps
    const dashedLine = createDashedLine(color)
    chartWrapper.appendChild(dashedLine)

    const pnlStr = `${pnl >= 0 ? "" : "-"}$${Math.abs(pnl).toFixed(2)}`

    const label = document.createElement("div")
    label.style.cssText = `
      position: absolute;
      left: 25%;
      z-index: 10;
      display: flex;
      align-items: center;
      transform: translateY(-50%);
      font-size: 11px;
      white-space: nowrap;
      pointer-events: auto;
      background: #1a1a1a;
      border: 1px solid ${color}88;
      border-radius: 4px;
      padding: 2px 4px 2px 8px;
      gap: 8px;
    `

    const pnlSpan = document.createElement("span")
    pnlSpan.style.cssText = `color: ${color}; font-weight: 500;`
    pnlSpan.textContent = `PnL ${pnlStr}`

    const sizeBadge = document.createElement("span")
    sizeBadge.style.cssText = `
      background: ${color};
      color: #fff;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 500;
    `
    sizeBadge.textContent = `${posSize} ${baseSymbol}`

    // Close (X) button — market close with 0.5% slippage
    const closeBtn = document.createElement("button")
    closeBtn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border: 1px solid ${color}66;
      background: transparent;
      color: ${color};
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 0;
      border-radius: 3px;
      opacity: 0.7;
      transition: opacity 0.15s;
    `
    closeBtn.textContent = "✕"
    closeBtn.onmouseenter = () => {
      closeBtn.style.opacity = "1"
    }
    closeBtn.onmouseleave = () => {
      closeBtn.style.opacity = "0.7"
    }
    closeBtn.onclick = (e) => {
      e.stopPropagation()
      // Read store imperatively so this effect doesn't have to depend on
      // `markPrices` — re-running on every tick would re-create the label
      // DOM, defeating the chart's animation work.
      const mp = useMarkPriceStore.getState().markPrices.get(marketName)
      if (!mp) return
      const mark = parseFloat(mp.mark_price)
      const slippage =
        position.side === "Long" ? mark * (1 - 0.005) : mark * (1 + 0.005)
      const closeSide = position.side === "Long" ? "Short" : "Long"
      closePosition.mutate({
        market: position.market,
        side: closeSide,
        is_ask: sideToIsAsk(closeSide),
        price: slippage.toFixed(1),
        size: position.size,
        base_amount: position.size,
        order_type: 1, // Market
        reduce_only: true,
        margin_mode: 1,
      })
    }

    label.appendChild(pnlSpan)
    label.appendChild(sizeBadge)
    label.appendChild(closeBtn)
    chartWrapper.appendChild(label)
    posLabelRef.current = label

    posTrackRef.current = trackLabelPositions(chart, cs, container, [
      { el: dashedLine, price: entryPrice, display: "block" },
      { el: label, price: entryPrice },
    ])

    return () => {
      posTrackRef.current?.()
      posTrackRef.current = null
      dashedLine.remove()
      if (posLabelRef.current) {
        posLabelRef.current.remove()
        posLabelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, showPositionLine, chartReady, indexToken.base])

  // Update page title with mark price
  useEffect(() => {
    if (!titleMarkPrice) return
    const price = parseFloat(titleMarkPrice.mark_price).toLocaleString(
      "en-US",
      {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }
    )
    const symbol = indexToken.base.toUpperCase()
    document.title = `${price} \u2022 ${symbol} \u2022 Elysia Perp`
  }, [titleMarkPrice, indexToken.base])

  const handleIntervalChange = (newInterval: string) => {
    setCurrentInterval(newInterval)
  }

  const toggleInterval = (iv: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation()
    setDisplayedIntervals((prev) => {
      if (prev.includes(iv)) {
        return prev.length > 1 ? prev.filter((i) => i !== iv) : prev
      }
      return [...prev, iv].sort(
        (a, b) =>
          SUPPORTED_INTERVALS.indexOf(
            a as (typeof SUPPORTED_INTERVALS)[number]
          ) -
          SUPPORTED_INTERVALS.indexOf(b as (typeof SUPPORTED_INTERVALS)[number])
      )
    })
  }

  const moreButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        moreMenuRef.current?.contains(target) ||
        moreButtonRef.current?.contains(target)
      )
        return
      setShowMoreMenu(false)
    }
    if (showMoreMenu) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showMoreMenu])

  // Live clock for bottom bar
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const time = now.toLocaleString("en-US", {
        timeZone: selectedTz,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      setClockStr(time)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [selectedTz])

  // Apply timezone formatters to chart
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    chart.applyOptions({
      localization: {
        timeFormatter: (time: number) => formatTimeForTz(time, selectedTz),
      },
      timeScale: {
        tickMarkFormatter: (time: number, tickType: TickMarkType) =>
          formatTickForTz(time, tickType, selectedTz),
      },
    })
  }, [selectedTz, chartReady])

  // Detect manual price scale changes (user dragging price axis disables autoScale)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const checkAutoScale = () => {
      try {
        const opts = chart.priceScale("right").options()
        setIsAutoScale(opts.autoScale)
      } catch {
        /* */
      }
    }
    // lightweight-charts doesn't have an autoScale change event, so poll on interactions
    const handler = () => requestAnimationFrame(checkAutoScale)
    const container = containerRef.current
    if (container) {
      container.addEventListener("mouseup", handler)
      container.addEventListener("wheel", handler)
      container.addEventListener("dblclick", handler)
    }
    return () => {
      if (container) {
        container.removeEventListener("mouseup", handler)
        container.removeEventListener("wheel", handler)
        container.removeEventListener("dblclick", handler)
      }
    }
  }, [chartReady])

  const handleAutoScale = () => {
    const chart = chartRef.current
    if (!chart) return
    const next = !isAutoScale
    chart.priceScale("right").applyOptions({ autoScale: next })
    setIsAutoScale(next)
  }

  // Close timezone menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        tzMenuRef.current?.contains(target) ||
        tzBtnRef.current?.contains(target)
      )
        return
      setShowTzMenu(false)
    }
    if (showTzMenu) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showTzMenu])

  const tzOffsetLabel = getUtcOffsetLabel(selectedTz)

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <div className="border-b border-border bg-card pb-2">
        <div className="flex flex-wrap gap-1 relative">
          {displayedIntervals.map((iv) => (
            <button
              key={iv}
              onClick={() => handleIntervalChange(iv)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors border cursor-pointer ${
                currentInterval === iv
                  ? "text-white border-none hover:text-white"
                  : "text-muted-foreground border-none hover:text-white"
              }`}
            >
              {iv}
            </button>
          ))}
          <div className="relative">
            <button
              ref={moreButtonRef}
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors border cursor-pointer ${
                showMoreMenu
                  ? "bg-muted text-foreground border-none"
                  : "text-muted-foreground hover:text-white border-none"
              }`}
            >
              More
            </button>
            {showMoreMenu && (
              <div
                ref={moreMenuRef}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-card border border-border rounded shadow-lg p-3 z-50 min-w-[280px]"
              >
                <div className="text-xs text-muted-foreground mb-3 font-medium">
                  Displayed timeframes
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {SUPPORTED_INTERVALS.map((iv) => {
                    const isSelected = displayedIntervals.includes(iv)
                    return (
                      <button
                        key={iv}
                        onClick={(e) => toggleInterval(iv, e)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`px-2 py-1 text-xs rounded transition-colors text-center flex items-center justify-center gap-1 cursor-pointer ${
                          isSelected
                            ? "bg-primary/20 text-primary border border-primary/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"
                        }`}
                      >
                        {isSelected && (
                          <svg
                            className="w-3 h-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        <span>{iv}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="ml-auto">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-white transition-colors cursor-pointer">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                    <circle cx="8" cy="6" r="1.5" fill="currentColor" />
                    <circle cx="16" cy="12" r="1.5" fill="currentColor" />
                    <circle cx="10" cy="18" r="1.5" fill="currentColor" />
                  </svg>
                  <span>Chart Elements</span>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={4}
                  className="z-50 min-w-[200px] rounded border border-border bg-card p-1 shadow-lg"
                >
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs text-foreground outline-none transition-colors hover:bg-muted"
                    onSelect={(e) => {
                      e.preventDefault()
                      setShowMarkers(!showMarkers)
                    }}
                  >
                    <span>Buy/Sell Marks</span>
                    {showMarkers && (
                      <span className="flex w-3 items-center justify-center text-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs text-foreground outline-none transition-colors hover:bg-muted"
                    onSelect={(e) => {
                      e.preventDefault()
                      setShowOrderLines(!showOrderLines)
                    }}
                  >
                    <span>Order Lines</span>
                    {showOrderLines && (
                      <span className="flex w-3 items-center justify-center text-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs text-foreground outline-none transition-colors hover:bg-muted"
                    onSelect={(e) => {
                      e.preventDefault()
                      setShowLiquidationLine(!showLiquidationLine)
                    }}
                  >
                    <span>Liquidation Line</span>
                    {showLiquidationLine && (
                      <span className="flex w-3 items-center justify-center text-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-xs text-foreground outline-none transition-colors hover:bg-muted"
                    onSelect={(e) => {
                      e.preventDefault()
                      setShowPositionLine(!showPositionLine)
                    }}
                  >
                    <span>Position Lines</span>
                    {showPositionLine && (
                      <span className="flex w-3 items-center justify-center text-foreground">
                        ✓
                      </span>
                    )}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative flex flex-col">
        <div className="px-2 py-2 border-b border-border bg-card/50">
          <div className="flex items-center justify-between text-xs">
            <div className="text-white">
              {indexToken.base.toUpperCase()} · {currentInterval} · Elysia Perp
            </div>
            <div className="flex items-center gap-6">
              {(hoveredCandle || ohlcData) &&
                (() => {
                  const d = hoveredCandle || ohlcData
                  if (!d) return null
                  const positive = d.close >= d.open
                  const color = positive ? "text-green-500" : "text-red-500"
                  return (
                    <>
                      <div className="flex items-center gap-4">
                        {(["O", "H", "L", "C"] as const).map((label) => {
                          const key = {
                            O: "open",
                            H: "high",
                            L: "low",
                            C: "close",
                          }[label] as keyof typeof d
                          return (
                            <div
                              key={label}
                              className="flex items-center gap-1"
                            >
                              <span className="text-white">{label}</span>
                              <span className={color}>
                                {(d[key] as number).toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                })}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-white">Vol</span>
                        <span className={color}>{d.volume.toFixed(4)}</span>
                      </div>
                    </>
                  )
                })()}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          {dataStatus === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                <span className="text-xs text-muted-foreground">
                  Loading chart...
                </span>
              </div>
            </div>
          )}
          {dataStatus === "unavailable" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card p-6">
              <div className="flex max-w-sm flex-col items-center gap-2 text-center">
                <span className="text-sm font-medium text-foreground">
                  Chart data unavailable
                </span>
                <span className="text-xs text-muted-foreground">
                  No trades on {marketName} yet, so candles haven’t started
                  generating. The chart will populate automatically once trading
                  activity begins.
                </span>
              </div>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
          {/* Trade badges (B/S inside a colored badge), positioned imperatively. */}
          <div
            ref={badgeOverlayRef}
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
          >
            {tradeBadges.map((b) => (
              <div
                key={b.id}
                data-badge
                data-time={b.time}
                data-price={b.price}
                data-side={b.isBuy ? "B" : "S"}
                onMouseEnter={(e) => {
                  const tip = markerTooltipRef.current
                  const el = e.currentTarget
                  if (!tip) return
                  const color = b.isBuy ? "#26a69a" : "#ef5350"
                  const avg = b.price.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })
                  const plural = b.count > 1 ? "s" : ""
                  tip.innerHTML =
                    `<div style="display:flex;gap:6px;align-items:center;white-space:nowrap;line-height:1.4">` +
                    `<span style="color:${color};font-weight:600">${
                      b.isBuy ? "Buy" : "Sell"
                    }</span>` +
                    `<span style="opacity:.6">Filled ${b.count} order${plural} · avg</span>` +
                    `<span style="font-variant-numeric:tabular-nums">${avg}</span>` +
                    `</div>`
                  tip.style.display = "block"
                  tip.style.left = `${parseFloat(el.style.left || "0") + 12}px`
                  tip.style.top = `${parseFloat(el.style.top || "0") + 12}px`
                }}
                onMouseLeave={() => {
                  const tip = markerTooltipRef.current
                  if (tip) tip.style.display = "none"
                }}
                style={{
                  display: "none",
                  transform: "translate(-50%, -50%)",
                  backgroundColor: b.isBuy ? "#26a69a" : "#ef5350",
                }}
                className="pointer-events-auto absolute flex h-[18px] w-[18px] cursor-default items-center justify-center rounded-[5px] text-[11px] font-bold leading-none text-white shadow"
              >
                {b.isBuy ? "B" : "S"}
                {/* Little pointer toward the candle (up for buy, down for sell). */}
                <span
                  className="absolute left-1/2 h-0 w-0 -translate-x-1/2"
                  style={
                    b.isBuy
                      ? {
                          bottom: "100%",
                          borderLeft: "4px solid transparent",
                          borderRight: "4px solid transparent",
                          borderBottom: "5px solid #26a69a",
                        }
                      : {
                          top: "100%",
                          borderLeft: "4px solid transparent",
                          borderRight: "4px solid transparent",
                          borderTop: "5px solid #ef5350",
                        }
                  }
                />
              </div>
            ))}
          </div>
          <div
            ref={markerTooltipRef}
            style={{ display: "none" }}
            className="pointer-events-none absolute z-30 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-[11px] text-foreground shadow-lg backdrop-blur-sm"
          />
        </div>

        {/* Bottom bar: timezone clock + Auto */}
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border bg-card px-2 h-7 text-xs text-muted-foreground">
          <div className="relative">
            <button
              ref={tzBtnRef}
              onClick={() => setShowTzMenu(!showTzMenu)}
              className="flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
            >
              <span className="text-foreground font-medium">{clockStr}</span>
              <span>{tzOffsetLabel}</span>
            </button>
            {showTzMenu && (
              <div
                ref={tzMenuRef}
                className="absolute bottom-full right-0 mb-1 max-h-[300px] w-[220px] overflow-y-auto rounded border border-border bg-card shadow-lg z-50"
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.tz}
                    onClick={() => {
                      setSelectedTz(opt.tz)
                      setShowTzMenu(false)
                    }}
                    className={`flex w-full items-center px-3 py-1.5 text-xs transition-colors hover:bg-muted cursor-pointer ${
                      selectedTz === opt.tz
                        ? "text-white bg-muted/50"
                        : "text-muted-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleAutoScale}
            onMouseEnter={() => {
              // Overlay on price scale canvas
              const container = containerRef.current
              if (!container) return
              const table = container.querySelector("table")
              if (!table) return
              // Price scale is the last td in the first row
              const cell = table.querySelector(
                "tr:first-child > td:last-child"
              ) as HTMLElement | null
              if (!cell) return
              // Ensure cell is positioned for overlay
              if (!cell.style.position) cell.style.position = "relative"
              let overlay = cell.querySelector(
                "[data-auto-overlay]"
              ) as HTMLElement | null
              if (!overlay) {
                overlay = document.createElement("div")
                overlay.setAttribute("data-auto-overlay", "")
                overlay.style.cssText = `
                  position: absolute; inset: 0; z-index: 3;
                  pointer-events: none;
                  background: rgba(255,255,255,0.07);
                  transition: opacity 0.2s;
                `
                cell.appendChild(overlay)
              }
              overlay.style.opacity = "1"
            }}
            onMouseLeave={() => {
              const container = containerRef.current
              if (!container) return
              const overlay = container.parentElement?.querySelector(
                "[data-auto-overlay]"
              ) as HTMLElement | null
              if (overlay) overlay.style.opacity = "0"
            }}
            className={`px-1.5 py-0.5 rounded text-xs transition-all cursor-pointer ${
              isAutoScale
                ? "text-white bg-white/10 shadow-[0_0_6px_rgba(255,255,255,0.15)]"
                : "text-muted-foreground hover:text-white"
            }`}
          >
            Auto
          </button>
        </div>
      </div>
    </div>
  )
}
