"use client"

import { useEffect, useRef, useState } from "react"
import type {
  ChartingLibraryWidgetOptions,
  EntityId,
  IChartingLibraryWidget,
  IOrderLineAdapter,
  ResolutionString,
} from "@/public/static/charting_library/charting_library"
import {
  createDatafeed,
  resolutionToMs,
  toBaseSymbol,
  type ElysiaDatafeed,
} from "@/lib/chart/datafeed"
import type { ExecutionBucket } from "@/lib/chart/executionMarkers"
import { createExecutionsIndicator } from "@/lib/chart/executionsStudy"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { usePerpOrderHistory } from "@/lib/hooks/usePerpOrderHistory"
import { useCancelPerpOrder } from "@/lib/hooks/useCancelPerpOrder"
import { useClosePositionModal } from "@/lib/stores/useClosePositionModal"
import { useMarketStore } from "@/lib/stores/useMarketStore"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import type { Pair } from "@/types"

const LONG_COLOR = "#0dbb92"
const SHORT_COLOR = "#f15044"
const LIQ_COLOR = "#f5a623"
const ORDER_COLOR = "#0086fc"
// The line/quantity badge sits on a dark chip; the body badge is the brand
// color. This split makes the label vs value read as two distinct blocks.
const CHIP_BG = "#0f0f0f"

// TradingView Advanced Charts (self-hosted charting_library) wired to Elysia's
// candle-api. Replaces the bespoke lightweight-charts chart to gain the full
// drawing-tool sidebar, indicators, and separated volume pane.
//
// The library files live in /public/static/charting_library (licensed; shared
// with the sibling waveX app under the same org). Under Next's Turbopack the
// library JS can NOT be bundled as a module (it throws "module has no
// exports"), so it's loaded at RUNTIME via the standalone script, which exposes
// `window.TradingView.widget`. We import only TYPES from the .d.ts here.

interface TradingViewGlobal {
  widget: new (options: ChartingLibraryWidgetOptions) => IChartingLibraryWidget
}
declare global {
  interface Window {
    TradingView?: TradingViewGlobal
  }
}

const SCRIPT_SRC = "/static/charting_library/charting_library.standalone.js"
let scriptPromise: Promise<void> | null = null

// Load the standalone library once, shared across chart mounts. A load FAILURE
// (flaky network) must not be cached: the failed <script> tag is removed and
// `scriptPromise` reset so the next mount retries instead of the chart staying
// dead for the whole session.
function loadLibrary(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (window.TradingView?.widget) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      // Loaded but global missing would mean a corrupt/wrong file — surface it.
      if (window.TradingView?.widget) resolve()
      else
        reject(new Error("charting_library loaded without TradingView global"))
    }
    script.onerror = () => {
      script.remove()
      reject(new Error("charting_library failed to load"))
    }
    document.head.appendChild(script)
  }).catch((e) => {
    scriptPromise = null
    throw e
  })
  return scriptPromise
}

interface Props {
  indexToken: Pair
  className?: string
}

export function AdvancedChart({ indexToken, className }: Props) {
  // Library/script failures used to be console-only, leaving a silent blank
  // pane on browsers we can't inspect (wallet in-app webviews) — surface it.
  const [loadError, setLoadError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<IChartingLibraryWidget | null>(null)
  // The current widget's datafeed — kept in a ref so the wake/backfill effect
  // can reset its bar cache before forcing the chart to re-request data.
  const datafeedRef = useRef<ElysiaDatafeed | null>(null)
  // Per-chart fill-marker map (candle-start ms → B/S stats). Owned by this
  // component and handed to the "Executions" study via closure, so two charts
  // side by side (dev data-check mode) can't clobber each other's markers.
  const markersRef = useRef<Map<number, ExecutionBucket>>(new Map())
  // EntityId of the currently-mounted "Executions" study (valid only for the
  // current widget instance; cleared on widget teardown).
  const executionsStudyRef = useRef<EntityId | null>(null)
  const [ready, setReady] = useState(false)
  const [intervalTick, setIntervalTick] = useState(0)

  // Symbol shown in the widget = the base ticker; the datafeed resolves it back
  // to the full market name for the candle-api.
  const symbol = indexToken.base.toUpperCase()
  const marketName = indexToken.name
  // Backend market_id — the WS candle channel is keyed by id, not name.
  const marketId = indexToken.id
  const { subscribe } = useWebSocket()

  // The widget-lifecycle effect keys on the COLLATERAL-INDEPENDENT base symbol
  // ("BTC-PERP"), NOT the full market name. On first load the selected pair is
  // a placeholder whose name is the base form; when the market list resolves,
  // the name gains its collateral suffix ("BTC-PERP" → "BTC-PERP-EL"). If the
  // full name were a dep, that transition would tear down a widget that is
  // still MID-BOOTSTRAP (the library script often loads first) and recreate
  // it — TradingView doesn't survive a mid-bootstrap remove() and the second
  // widget rendered a permanently empty chart ("∅" legend, no bars) even
  // though its datafeed delivered data. The price feed is identical across
  // collaterals, so the widget never needs recreating for a suffix change;
  // the datafeed instead reads the LATEST name/id through these refs.
  const baseMarket = toBaseSymbol(marketName)
  const marketNameRef = useRef(marketName)
  const marketIdRef = useRef(marketId)
  useEffect(() => {
    marketNameRef.current = marketName
    marketIdRef.current = marketId
  }, [marketName, marketId])
  // Do NOT create the widget until the real market list is in: the initial
  // DEFAULT_PAIR name lacks the collateral suffix, and on candle servers
  // keyed by FULL market name every getBars probe 400s -> the datafeed
  // reports an error and TradingView permanently marks the symbol dead
  // (empty chart, "∅" legend) for the widget's lifetime. Waiting costs one
  // render; the effect runs again the moment the list lands.
  const marketsLoaded = useMarketStore((st) => st.marketsLoaded)

  const positions = usePositionsList()
  const { data: openOrdersData } = useOpenPerpOrders()
  const { data: orderHistoryData } = usePerpOrderHistory()
  const cancelOrder = useCancelPerpOrder()
  const requestClosePosition = useClosePositionModal((s) => s.requestClose)

  // Latest values in refs so the (ready-gated) draw effect below doesn't need to
  // re-run — and re-create every line — on each mutation-hook identity change.
  const cancelOrderRef = useRef(cancelOrder)
  const requestCloseRef = useRef(requestClosePosition)
  useEffect(() => {
    cancelOrderRef.current = cancelOrder
    requestCloseRef.current = requestClosePosition
  }, [cancelOrder, requestClosePosition])

  useEffect(() => {
    if (!marketsLoaded) return
    let disposed = false
    let datafeed: ElysiaDatafeed | null = null

    loadLibrary()
      .then(async () => {
        // Yield one macrotask before creating the widget. Under React
        // StrictMode (dev) the mount → simulated-unmount → remount sequence
        // can interleave with this promise chain when the library script is
        // already loaded: the FIRST mount's .then would run before its own
        // cleanup, create a widget, and that widget would be remove()d
        // MID-BOOTSTRAP a moment later. TradingView doesn't survive that —
        // the second (real) widget then initialises into a poisoned
        // container and renders a permanently empty chart (no bars, "∅"
        // legend) even though its datafeed delivers data. Confirmed by
        // logging: every broken load showed create → immediate remove →
        // create; every clean load showed a single create. Deferring one
        // macrotask guarantees the strict double-invoke has fully finished,
        // so generation 1 sees `disposed=true` and skips, and exactly ONE
        // widget is ever constructed. (One 0 ms delay is imperceptible.)
        await new Promise((r) => setTimeout(r, 0))
        if (disposed || !containerRef.current) return
        const Widget = window.TradingView?.widget
        if (!Widget) return

        // Realtime via the shared WS: REST alone can't show the in-progress
        // candle (the candle-api only serves closed 1m candles — the current
        // bar for every interval comes from `candle/{id}/{interval}` WS).
        datafeed = createDatafeed(() => marketNameRef.current, {
          subscribe,
          resolveMarketId: () => marketIdRef.current,
        })
        datafeedRef.current = datafeed
        // Mobile: the desktop widget config wastes most of a phone screen —
        // the left drawing toolbar alone eats ~15% of the width, and the
        // fixed-px axis/legend fonts read oversized at narrow widths, leaving
        // little room for actual candles. Evaluated once at widget creation:
        // a desktop resize crossing the breakpoint keeps the current chrome
        // until the next mount, which is fine — real phones never cross it.
        const isMobile = window.matchMedia("(max-width: 767px)").matches

        const options: ChartingLibraryWidgetOptions = {
          symbol,
          datafeed,
          interval: "15" as ResolutionString,
          container: containerRef.current,
          library_path: "/static/charting_library/",
          locale: "en",
          timezone: "Etc/UTC",
          theme: "dark",
          autosize: true,
          // Recolors the iframe chrome (header, drawing toolbar, bottom bar,
          // menus) to the app's black — see public/static/charting_style.css.
          custom_css_url: "/static/charting_style.css",
          // Registers the "Executions" study that renders my-trade B/S badges
          // (pentagon labels) natively on the canvas. Data flows through this
          // chart's own marker map via the closed-over getter.
          custom_indicators_getter: (pine) =>
            Promise.resolve([
              createExecutionsIndicator(pine, (timeMs) =>
                markersRef.current.get(timeMs)
              ),
            ]),
          disabled_features: [
            "header_symbol_search",
            "symbol_search_hot_key",
            "header_compare",
            "display_market_status",
            "show_interval_dialog_on_key_press",
            "popup_hints",
            "use_localstorage_for_settings",
            // The library defaults to drawing the Volume study ON TOP of the
            // candle pane; disabling this puts it in its own pane below the
            // candles (Lighter-style separation).
            "volume_force_overlay",
            // Mobile: reclaim screen for the candles — the left drawing
            // toolbar (unusable on touch anyway) eats ~15% of the width, and
            // the bottom "Date Range / go-to" bar eats scarce height.
            ...(isMobile
              ? (["left_toolbar", "timeframes_toolbar"] as const)
              : []),
          ],
          enabled_features: ["hide_resolution_in_legend", "items_favoriting"],
          favorites: {
            intervals: [
              "1",
              "5",
              "15",
              "60",
              "240",
              "1D",
            ] as ResolutionString[],
            chartTypes: ["Candles"],
          },
          loading_screen: {
            backgroundColor: "#0a0a0a",
            foregroundColor: "#0a0a0a",
          },
          overrides: {
            "paneProperties.background": "#0a0a0a",
            "paneProperties.backgroundType": "solid",
            // Overriding the background alone leaves the theme's grid/axis
            // colors nearly invisible against #0a0a0a — set them explicitly.
            "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.07)",
            "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.07)",
            "scalesProperties.textColor": "#b2b5be",
            "scalesProperties.lineColor": "rgba(255,255,255,0.12)",
            "mainSeriesProperties.candleStyle.upColor": "#0dbb92",
            "mainSeriesProperties.candleStyle.downColor": "#f15044",
            "mainSeriesProperties.candleStyle.borderUpColor": "#0dbb92",
            "mainSeriesProperties.candleStyle.borderDownColor": "#f15044",
            "mainSeriesProperties.candleStyle.wickUpColor": "#0dbb92",
            "mainSeriesProperties.candleStyle.wickDownColor": "#f15044",
            // Mobile: shrink the fixed-px chrome so candles get the space —
            // smaller price/time axis labels and legend text.
            ...(isMobile
              ? {
                  "scalesProperties.fontSize": 10,
                  "paneProperties.legendProperties.showSeriesTitle": false,
                }
              : {}),
          },
        }

        const w = new Widget(options)
        widgetRef.current = w
        w.onChartReady(() => {
          if (disposed) return
          // autosize measures the container via a ResizeObserver; nudge it once
          // more after ready so the chart canvases fill the iframe even if the
          // flex layout settled a frame late.
          requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
          setReady(true)
          // Re-bucket my-trade markers when the timeframe changes.
          try {
            w.activeChart()
              .onIntervalChanged()
              .subscribe(null, () => setIntervalTick((t) => t + 1))
          } catch {
            /* interval subscription is best-effort */
          }
        })
      })
      .catch((e) => {
        console.error("[AdvancedChart]", e)
        setLoadError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      disposed = true
      setReady(false)
      // Any study id from the torn-down chart is meaningless on the next
      // widget — clearing it stops the markers effect from calling
      // removeEntity with a stale EntityId on the fresh chart.
      executionsStudyRef.current = null
      try {
        widgetRef.current?.remove()
      } catch {
        /* iframe may already be gone */
      }
      widgetRef.current = null
      // remove() on a widget that is still bootstrapping can leave a zombie
      // iframe behind (it renders an empty chart forever and sits on top of
      // any widget created afterwards). Sweep the container so the next
      // widget always starts clean.
      if (containerRef.current) containerRef.current.innerHTML = ""
      // The library doesn't reliably call unsubscribeBars on remove(); sweep
      // this widget's poll timers so they don't keep hitting the candle-api.
      datafeed?.dispose()
      datafeedRef.current = null
    }
  }, [symbol, baseMarket, subscribe, marketsLoaded])

  // Backfill on wake / refocus. The realtime path (datafeed.subscribeBars)
  // only polls the LAST two bars every 1s; while the tab is backgrounded or
  // the laptop is asleep that timer is suspended, so candles formed in the
  // gap are never fetched and the chart renders with holes until a reload.
  //
  // Force a full re-request whenever we might have fallen behind. Triggers
  // are layered because no single one fires in every case:
  //   • visibilitychange → tab refocus
  //   • window focus / online → window refocus, network recovery
  //   • wall-clock watchdog → the ONLY reliable signal for laptop sleep/wake:
  //     a self-correcting interval notices real time jumped far more than its
  //     period (timer was suspended) even when no DOM event fires.
  useEffect(() => {
    if (!ready) return

    const backfill = () => {
      const w = widgetRef.current
      if (!w) return
      try {
        // Reset the datafeed's per-series cache first (library requirement),
        // then re-request — the widget re-calls getBars for full history.
        datafeedRef.current?.resetCache()
        w.activeChart().resetData()
      } catch {
        /* chart may be mid-teardown */
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") backfill()
    }

    // Watchdog, two independent checks per tick:
    //  1) Timer suspension: expected to tick every WATCHDOG_MS; if the real
    //     gap is much larger, the timer (and the poll timer alongside it)
    //     was frozen (sleep/background) — wake.
    //  2) Data staleness: no bar delivered for DATA_STALE_MS even though the
    //     tab stayed awake. This is the "silently dead realtime path" case —
    //     a zombified WS (no onclose → no resubscribe) combined with a
    //     wedged/failing REST poll froze the chart at a fixed time while the
    //     rest of the app stayed live; no focus/visibility event ever fired
    //     because the user never left the tab. Rate-limited by
    //     MIN_BACKFILL_GAP_MS so a genuinely quiet market (no trades → no
    //     candles) re-requests at most once per gap, not every tick.
    const WATCHDOG_MS = 5_000
    const STALE_MS = 15_000
    const DATA_STALE_MS = 120_000
    const MIN_BACKFILL_GAP_MS = 120_000
    let last = Date.now()
    let lastBackfillAt = 0
    const watchdog = setInterval(() => {
      const now = Date.now()
      if (now - last > STALE_MS) {
        backfill()
        lastBackfillAt = now
      } else if (
        datafeedRef.current?.isStale(DATA_STALE_MS) &&
        now - lastBackfillAt > MIN_BACKFILL_GAP_MS
      ) {
        backfill()
        lastBackfillAt = now
      }
      last = now
    }, WATCHDOG_MS)

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", backfill)
    window.addEventListener("online", backfill)
    return () => {
      clearInterval(watchdog)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", backfill)
      window.removeEventListener("online", backfill)
    }
  }, [ready])

  // Draw position (entry + liquidation) and open-order lines on the chart using
  // TradingView's native order-line API, mirroring the old lightweight chart's
  // overlays. Rebuilds whenever positions/orders change; each line is removed on
  // cleanup so we never leak adapters across updates.
  //
  // Depend on the store-owned `orders` ARRAY, not the hook's `{data:{orders}}`
  // wrapper — the wrapper is a fresh object every render, which would tear all
  // lines down and recreate them (visible flicker) about once a second.
  const openOrders = openOrdersData?.orders
  useEffect(() => {
    if (!ready) return
    const w = widgetRef.current
    if (!w) return

    let chart: ReturnType<IChartingLibraryWidget["activeChart"]>
    try {
      chart = w.activeChart()
    } catch {
      return
    }

    const lines: IOrderLineAdapter[] = []
    // v32: createOrderLine() became async. Lines resolving AFTER this
    // effect's cleanup would leak onto the next render's chart, so cleanup
    // flips this flag and late arrivals remove themselves immediately.
    let disposed = false
    // A line has: [quantity chip | body badge]. The quantity chip is a dark
    // pill (label), the body badge is the brand color (value) — visually split.
    // `onCancel` renders the X button (order-line's built-in cancel affordance)
    // and wires the callback.
    const addLine = (opts: {
      price: number
      color: string
      label: string // dark quantity chip (left)
      value: string // colored body badge (right)
      onCancel?: () => void
      cancelTooltip?: string
    }) => {
      const { price, color, label, value, onCancel, cancelTooltip } = opts
      if (!Number.isFinite(price) || price <= 0) return
      // `createOrderLine` is a Trading Platform-only API as of charting
      // library v32 — on our Advanced Charts license the method still
      // EXISTS on the prototype but throws SYNCHRONOUSLY when called
      // ("only available on Trading Platform"), which took down the whole
      // page. A `typeof` guard isn't enough (the method is present) and a
      // `.catch()` can't catch a synchronous throw, so the call itself is
      // wrapped in try/catch. Skip drawing the entry/liq/order lines
      // rather than crashing; the chart renders fine without them.
      let pending: ReturnType<typeof chart.createOrderLine>
      try {
        pending = chart.createOrderLine()
      } catch {
        return
      }
      pending
        .then((line) => {
          if (disposed) {
            try {
              line.remove()
            } catch {
              /* chart already gone */
            }
            return
          }
          line
            .setPrice(price)
            .setLineColor(color)
            .setLineStyle(2)
            // Length is measured from the right (price) axis leftward, so a
            // small pixel value keeps the badges on the RIGHT with a gap.
            .setLineLength(30, "pixel")
            // Body badge = colored value block.
            .setText(value)
            .setBodyBorderColor(color)
            .setBodyBackgroundColor(color)
            .setBodyTextColor("#ffffff")
            // Quantity chip = dark label block for a crisp divide.
            .setQuantity(label)
            .setQuantityBorderColor(color)
            .setQuantityBackgroundColor(CHIP_BG)
            .setQuantityTextColor(color)
          if (onCancel) {
            line
              .setCancelButtonIconColor("#ffffff")
              .setCancelButtonBorderColor(color)
              .setCancelButtonBackgroundColor(color)
              .onCancel(onCancel)
            if (cancelTooltip) line.setCancelTooltip(cancelTooltip)
          }
          lines.push(line)
        })
        .catch(() => {
          /* chart may be tearing down */
        })
    }

    // Position: entry (with a Close X → opens the Close-Position modal) +
    // liquidation for the current market.
    const position = positions.find((p) => p.market === marketName)
    if (position) {
      const isLong = position.side === "Long"
      addLine({
        price: parseFloat(position.entry_price),
        color: isLong ? LONG_COLOR : SHORT_COLOR,
        label: `${position.side} ${parseFloat(position.size)}`,
        value: "Entry",
        onCancel: () => requestCloseRef.current(position),
        cancelTooltip: "Close position",
      })
      addLine({
        price: parseFloat(position.liquidation_price),
        color: LIQ_COLOR,
        label: "Liq",
        value: "Liq. Price",
      })
    }

    // Open limit orders for this market (with a Cancel X → cancels the order).
    for (const order of openOrders ?? []) {
      if (order.market !== marketName) continue
      const qty = parseFloat(order.remaining_base_amount)
      addLine({
        price: parseFloat(order.price),
        color: ORDER_COLOR,
        label: `${order.side} ${Number.isFinite(qty) ? qty : ""}`.trim(),
        value: order.order_type,
        onCancel: () =>
          cancelOrderRef.current.mutate({
            order_id: order.id,
            market: order.market,
          }),
        cancelTooltip: "Cancel order",
      })
    }

    return () => {
      disposed = true
      for (const line of lines) {
        try {
          line.remove()
        } catch {
          /* already removed with the chart */
        }
      }
    }
  }, [ready, marketName, positions, openOrders])

  // My-trade markers: OKX-style pentagon badges (green "B" below the candle,
  // red "S" above) via the custom "Executions" study — the only TradingView
  // primitive that renders label shapes. Fills are bucketed per (candle, side)
  // into the shared marker map the study reads; the study is then re-added to
  // force a recalculation (studies only recompute on new bars otherwise).
  // `intervalTick` re-runs this when the user switches timeframe, since the
  // candle bucket size changes with resolution.
  useEffect(() => {
    if (!ready) return
    const w = widgetRef.current
    if (!w) return
    let chart: ReturnType<IChartingLibraryWidget["activeChart"]>
    try {
      chart = w.activeChart()
    } catch {
      return
    }

    const bucketMs = resolutionToMs(String(chart.resolution()))

    // Bucket this market's fills by candle-start time (ms — matches the bar
    // time the study sees via PineJS.Std.time), tracking per-side fill count
    // and size-weighted average price for the hover tooltip.
    type SideAgg = { count: number; sizeSum: number; notionalSum: number }
    const aggs = new Map<number, { buy?: SideAgg; sell?: SideAgg }>()
    for (const order of orderHistoryData?.orders ?? []) {
      if (order.market !== marketName) continue
      const filled = parseFloat(order.filled_base_amount)
      if (!(filled > 0)) continue
      const orderMs = new Date(order.created_at).getTime()
      const candleMs = Math.floor(orderMs / bucketMs) * bucketMs
      const side = order.side === "Long" ? "buy" : "sell"
      const bucket = aggs.get(candleMs) ?? {}
      const agg = bucket[side] ?? { count: 0, sizeSum: 0, notionalSum: 0 }
      agg.count += 1
      agg.sizeSum += filled
      agg.notionalSum += filled * (parseFloat(order.price) || 0)
      bucket[side] = agg
      aggs.set(candleMs, bucket)
    }
    const buckets = new Map<number, ExecutionBucket>()
    for (const [candleMs, bucket] of aggs) {
      const toStats = (a?: SideAgg) =>
        a && a.sizeSum > 0
          ? { count: a.count, avgPrice: a.notionalSum / a.sizeSum }
          : undefined
      buckets.set(candleMs, {
        buy: toStats(bucket.buy),
        sell: toStats(bucket.sell),
      })
    }
    markersRef.current = buckets

    // (Re)create the study so it recalculates against the fresh marker map.
    let cancelled = false
    const prev = executionsStudyRef.current
    if (prev) {
      executionsStudyRef.current = null
      try {
        chart.removeEntity(prev)
      } catch {
        /* already gone with a prior chart instance */
      }
    }
    if (buckets.size > 0) {
      chart
        .createStudy("Executions", true, true)
        .then((id) => {
          if (!id) return
          if (cancelled) {
            try {
              chart.removeEntity(id)
            } catch {
              /* chart torn down */
            }
            return
          }
          executionsStudyRef.current = id
        })
        .catch(() => {
          /* study creation is best-effort */
        })
    }

    return () => {
      cancelled = true
    }
  }, [ready, marketName, orderHistoryData, intervalTick])

  // Hover tooltip for the B/S badges: when the crosshair sits on a candle that
  // has fills, show "Filled N order(s) · Average buy/sell price X" in an HTML
  // chip positioned near the cursor (rendered OUTSIDE the widget iframe — the
  // study shapes themselves have no tooltip API). Positioned via the
  // crosshair event's offsetX/offsetY, which are relative to the container.
  useEffect(() => {
    if (!ready) return
    const w = widgetRef.current
    if (!w) return
    let chart: ReturnType<IChartingLibraryWidget["activeChart"]>
    try {
      chart = w.activeChart()
    } catch {
      return
    }

    const hide = () => {
      const tip = tooltipRef.current
      if (tip) tip.style.display = "none"
    }

    const onMove = (params: {
      time?: number
      offsetX?: number
      offsetY?: number
    }) => {
      const tip = tooltipRef.current
      if (!tip) return
      if (
        params.time == null ||
        params.offsetX == null ||
        params.offsetY == null
      ) {
        hide()
        return
      }
      const bucketMs = resolutionToMs(String(chart.resolution()))
      const candleMs = Math.floor((params.time * 1000) / bucketMs) * bucketMs
      const bucket = markersRef.current.get(candleMs)
      if (!bucket || (!bucket.buy && !bucket.sell)) {
        hide()
        return
      }

      const fmt = (v: number) =>
        v.toLocaleString("en-US", { maximumFractionDigits: 2 })
      const row = (
        stats: { count: number; avgPrice: number },
        side: "buy" | "sell"
      ) =>
        `<div style="display:flex;gap:6px;align-items:baseline;white-space:nowrap">` +
        `<span style="color:#e5e5e5">Filled ${stats.count} order${stats.count > 1 ? "s" : ""}</span>` +
        `<span style="color:${side === "buy" ? LONG_COLOR : SHORT_COLOR}">Average ${side} price</span>` +
        `<span style="color:#ffffff;font-family:ui-monospace,monospace">${fmt(stats.avgPrice)}</span>` +
        `</div>`
      tip.innerHTML =
        (bucket.buy ? row(bucket.buy, "buy") : "") +
        (bucket.sell ? row(bucket.sell, "sell") : "")

      tip.style.display = "block"
      const parent = tip.parentElement
      if (!parent) return
      const pw = parent.clientWidth
      let left = params.offsetX + 14
      if (left + tip.offsetWidth > pw - 8) {
        left = params.offsetX - tip.offsetWidth - 14
      }
      tip.style.left = `${Math.max(8, left)}px`
      tip.style.top = `${Math.max(8, params.offsetY - tip.offsetHeight - 12)}px`
    }

    const sub = chart.crossHairMoved()
    sub.subscribe(null, onMove)
    // The crosshair event doesn't fire when the pointer leaves the chart, so
    // clear the tooltip on mouseleave of our wrapper.
    const wrapper = tooltipRef.current?.parentElement
    wrapper?.addEventListener("mouseleave", hide)

    return () => {
      try {
        sub.unsubscribe(null, onMove)
      } catch {
        /* widget already torn down */
      }
      wrapper?.removeEventListener("mouseleave", hide)
      hide()
    }
  }, [ready])

  return (
    <div className={`relative ${className ?? "h-full w-full"}`}>
      <div ref={containerRef} className="h-full w-full" />
      {loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-background/80 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            Chart failed to load — pull down to refresh or reopen the page.
          </p>
          <p className="max-w-full truncate text-xs text-muted-foreground/60">
            {loadError}
          </p>
        </div>
      )}
      <div
        ref={tooltipRef}
        style={{ display: "none" }}
        className="pointer-events-none absolute z-20 flex flex-col gap-1 rounded-md border border-[#3a3a3a] bg-[#2b2b2b]/95 px-3 py-2 text-[13px] shadow-lg"
      />
    </div>
  )
}
