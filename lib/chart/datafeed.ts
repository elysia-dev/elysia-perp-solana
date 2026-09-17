import type {
  Bar,
  DatafeedConfiguration,
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
} from "@/public/static/charting_library/charting_library"

// TradingView Advanced Charts datafeed backed by Elysia's OHLCV server
// (`/candle-api/markets/{market}/candles`). The widget owns rendering, drawing
// tools, and indicators; this adapter just feeds it bars.

// Single source of truth for the resolutions the chart supports. Everything
// else (backend interval string, candle bucket size, favorites) derives from
// this table so adding a resolution can't silently miss one of the maps.
const RESOLUTIONS = [
  { resolution: "1", interval: "1m", ms: 60_000 },
  { resolution: "5", interval: "5m", ms: 300_000 },
  { resolution: "15", interval: "15m", ms: 900_000 },
  { resolution: "60", interval: "1h", ms: 3_600_000 },
  { resolution: "240", interval: "4h", ms: 14_400_000 },
  { resolution: "1D", interval: "1d", ms: 86_400_000 },
] as const

export const SUPPORTED_RESOLUTIONS = RESOLUTIONS.map(
  (r) => r.resolution
) as unknown as ResolutionString[]

function toInterval(resolution: string): string {
  return RESOLUTIONS.find((r) => r.resolution === resolution)?.interval ?? "15m"
}

/** Candle bucket size (ms) for a TradingView resolution. */
export function resolutionToMs(resolution: string): number {
  return RESOLUTIONS.find((r) => r.resolution === resolution)?.ms ?? 900_000
}

interface RawCandle {
  t: number // UNIX seconds (candle-api convention)
  o: string
  h: string
  l: string
  c: string
  v: string // base volume (BTC), typically < 1 → rounds to "0" on the axis
  qv?: string // quote volume (USD notional) — shown instead, like "$61.79K"
}
interface CandleServerResponse {
  candles?: RawCandle[]
}

/** Strip the collateral suffix: "BTC-PERP-EL" → "BTC-PERP". Exported so the
 *  chart component can key its widget lifecycle on the collateral-independent
 *  base (the price feed is identical across collaterals). */
export function toBaseSymbol(market: string): string {
  const marker = "-PERP"
  const idx = market.indexOf(marker)
  return idx === -1 ? market : market.slice(0, idx + marker.length)
}

/**
 * Per-bar quote (USD) volume for the chart's volume pane — USD so the axis
 * shows a meaningful figure instead of the sub-1 base volume that rounds
 * to "0".
 *
 * The server's `qv` is the exact sum of price×size per trade and is the
 * PREFERRED source — but the ohlcv-server currently reports it 10× too
 * small (quote-scale digit dropped: BTC bar v=0.00056 @ ~$64k reports
 * qv=3.1 where the true notional is ~$36; verified 2026-07-31 against the
 * main server's WS `V`, which is correct). So: sanity-check `qv` against
 * the close×size approximation and only trust it when the two agree to
 * within 2×. While the bug ships, every bar fails the check and uses
 * close×size; the moment a fixed ohlcv deploy lands (per env, whenever
 * that happens), `qv` passes and is used automatically — no frontend
 * revert needed.
 */
function candleQuoteVolume(c: RawCandle): number {
  const approx = parseFloat(c.c) * parseFloat(c.v)
  const qv = c.qv != null ? parseFloat(c.qv) : NaN
  if (Number.isFinite(qv) && qv > 0 && Number.isFinite(approx) && approx > 0) {
    const ratio = qv / approx
    if (ratio > 0.5 && ratio < 2) return qv
  }
  return Number.isFinite(approx) ? approx : parseFloat(c.v)
}

/**
 * Fetch timeout signal with a fallback for browsers without
 * `AbortSignal.timeout` (Chromium <103 — notably Samsung Internet ≤19, the
 * Galaxy default browser). Without this the very first candle fetch threw
 * synchronously there and the chart stayed permanently blank.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/**
 * Fetch bars. The candle server keys markets by the FULL market name
 * ("BTC-PERP-EL") — verified on both dev and prod; the base form
 * ("BTC-PERP") returns `400 Unknown market`, so no fallback probing.
 * Distinguishes outcomes so callers can react correctly:
 * - `Bar[]` (possibly empty) — the server recognised the market; an empty
 *   array is a genuine "no candles in range".
 * - `null` — transport/HTTP failure; retryable, and must NOT be reported to
 *   TradingView as `noData` (that permanently marks the symbol empty for
 *   the session).
 */
async function fetchBars(
  market: string,
  interval: string,
  limit: number,
  endTime?: number
): Promise<Bar[] | null> {
  const params = new URLSearchParams({ interval, limit: String(limit) })
  if (endTime) params.set("endTime", String(endTime))

  try {
    const res = await fetch(
      `/candle-api/markets/${encodeURIComponent(market)}/candles?${params}`,
      // The timeout is load-bearing for the realtime poll: subscribeBars'
      // 1s poll is guarded by an `inFlight` flag that only clears when this
      // promise settles. A hung request (half-open connection after a
      // network blip — the same event that zombifies the WS) would
      // otherwise leave `inFlight` stuck true and kill the poll FOREVER,
      // freezing the chart while the rest of the app stays live.
      { cache: "no-store", signal: timeoutSignal(8_000) }
    )
    if (!res.ok) return null
    const json: CandleServerResponse = await res.json()
    return (json.candles ?? []).map((c) => ({
      time: c.t * 1000, // candle-api gives seconds; TradingView wants ms
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: candleQuoteVolume(c),
    }))
  } catch {
    return null
  }
}

const configurationData: DatafeedConfiguration = {
  supported_resolutions: SUPPORTED_RESOLUTIONS,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Sub {
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
  lastBarTime: number
  // Library-provided callback (5th arg of subscribeBars) that discards the
  // widget's cached bars for this series. Must be invoked before resetData()
  // so the chart re-requests full history instead of trusting stale cache.
  onResetCacheNeeded: () => void
  /** Unsubscribe from the WS candle channel (when a realtime source is wired). */
  wsUnsub?: () => void
  /** Wall-clock ms of the last WS candle message; gates the REST poll. */
  lastWsMsgAt: number
  /** Wall-clock ms of the last bar actually delivered to TradingView (via
   *  either the WS handler or the REST poll). Drives `isStale()` — the
   *  chart-side watchdog that heals a silently dead realtime path. */
  lastDeliveredAt: number
}

/** Payload of `subscribed/candle` / `update/candle` WS frames. `t` is the
 *  candle bucket start in MILLISECONDS (unlike the REST API's seconds). */
interface WsCandleData {
  t: number
  o: string
  h: string
  l: string
  c: string
  v: string // base volume
  V?: string // quote (USD) volume
  n: number
  closed: boolean
}

interface WsCandleMessage {
  type?: string
  channel?: string
  data?: WsCandleData
}

/**
 * Optional realtime source for `subscribeBars`, wired to the app's shared
 * WebSocket. WHY THIS EXISTS: the candle REST API only returns CLOSED 1m
 * candles — the in-progress minute is never in the payload (higher intervals'
 * current bucket is aggregated from closed 1m candles, so it lags up to a
 * minute and is missing right after the bucket opens). Polling REST therefore
 * renders the chart permanently one bar behind on 1m ("it's :58 but the chart
 * ends at :57") and leaves the current bucket stale on every interval. The WS
 * `candle/{marketId}/{interval}` channel DOES stream the live in-progress
 * candle tick-by-tick (including an immediate snapshot on subscribe), so it is
 * the only way to show the current bar.
 */
export interface RealtimeCandleSource {
  /** WebSocketProvider's subscribe: registers a handler, returns unsubscribe. */
  subscribe: (channel: string, handler: (msg: unknown) => void) => () => void
  /** Backend numeric market_id for the WS channel (e.g. 100 for BTC-PERP-EL). */
  resolveMarketId: (symbol: string) => number | null | undefined
}

/** Poll only while WS has been silent this long. WS silence on a quiet market
 *  is normal (no trades → no frames), and in that case REST has nothing newer
 *  either — but if the socket died, polling keeps closed bars flowing. */
const WS_QUIET_MS = 10_000

/** IBasicDataFeed plus a dispose() the owning component calls on unmount —
 *  the library doesn't reliably call unsubscribeBars during widget.remove(),
 *  and the poll timers live in the parent window, so without this sweep a
 *  timer per market switch would keep polling a dead market forever. */
export interface ElysiaDatafeed extends IBasicDataFeed {
  dispose(): void
  /** Reset every active subscription's bar cache. Call this, then
   *  `activeChart().resetData()`, to backfill candles missed while the poll
   *  timer was suspended (laptop sleep / long background). */
  resetCache(): void
  /** True when some active subscription hasn't delivered a bar to TradingView
   *  in `maxAgeMs` — the signal that the realtime path is silently dead (WS
   *  zombie + wedged/failing poll) and the owner should force a backfill. */
  isStale(maxAgeMs: number): boolean
}

/**
 * Build the datafeed. `resolveMarket(symbol)` maps a TradingView symbol back to
 * the Elysia market name (e.g. "BTC" → "BTC-PERP-EL"). Each widget gets its own
 * instance with its own subscription map — TradingView's subscriberUID is only
 * unique per (symbol, resolution), so a shared module-level map would collide
 * when two widgets show the same market (dev data-check mode).
 */
export function createDatafeed(
  resolveMarket: (symbol: string) => string,
  realtime?: RealtimeCandleSource
): ElysiaDatafeed {
  const subscriptions = new Map<string, Sub>()

  return {
    onReady: (cb) => {
      setTimeout(() => cb(configurationData), 0)
    },

    searchSymbols: (_userInput, _exchange, _symbolType, onResult) => {
      onResult([])
    },

    resolveSymbol: (symbolName, onResolve, onError) => {
      try {
        const symbolInfo: LibrarySymbolInfo = {
          ticker: symbolName,
          name: symbolName,
          description: `${symbolName} / USD`,
          type: "crypto",
          session: "24x7",
          timezone: "Etc/UTC",
          exchange: "Elysia",
          listed_exchange: "Elysia",
          format: "price",
          minmov: 1,
          pricescale: 100,
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: false,
          supported_resolutions: SUPPORTED_RESOLUTIONS,
          // Quote (USD) volume is a large integer-ish figure; no decimals so it
          // reads "341" / "6.01K" rather than "341.00".
          volume_precision: 0,
          data_status: "streaming",
          currency_code: "USD",
        }
        setTimeout(() => onResolve(symbolInfo), 0)
      } catch (e) {
        onError(e instanceof Error ? e.message : "resolveSymbol error")
      }
    },

    getBars: async (
      symbolInfo,
      resolution,
      periodParams,
      onResult,
      onError
    ) => {
      try {
        const { countBack, to, firstDataRequest } = periodParams
        const market = resolveMarket(symbolInfo.name)
        const interval = toInterval(resolution)
        // `to` is a unix-seconds upper bound; the candle-api's endTime is also
        // in seconds, so pass it through as-is.
        const endTime = firstDataRequest ? undefined : to
        const limit = Math.max(countBack, 300)

        let bars = await fetchBars(market, interval, limit, endTime)

        // Transport failures are retryable; surface as an error (NOT noData)
        // if they persist so TradingView doesn't mark the symbol empty.
        for (let attempt = 0; bars === null && attempt < 2; attempt++) {
          await sleep(400)
          bars = await fetchBars(market, interval, limit, endTime)
        }
        if (bars === null) {
          onError("candle server unavailable")
          return
        }

        // A cold proxy can answer 200 with an empty payload once — retry a
        // single time before trusting it (applies to scrollback requests too:
        // a flaky empty there would otherwise permanently truncate history).
        if (bars.length === 0) {
          await sleep(300)
          const again = await fetchBars(market, interval, limit, endTime)
          if (again && again.length > 0) bars = again
        }

        if (bars.length === 0) {
          onResult([], { noData: true })
          return
        }
        onResult(bars, { noData: false })
      } catch (e) {
        onError(e instanceof Error ? e.message : "getBars error")
      }
    },

    subscribeBars: (
      symbolInfo,
      resolution,
      onTick,
      subscriberUID,
      onResetCacheNeeded
    ) => {
      const market = resolveMarket(symbolInfo.name)
      const interval = toInterval(resolution)
      const sub: Sub = {
        timer: 0 as unknown as ReturnType<typeof setInterval>,
        inFlight: false,
        lastBarTime: 0,
        onResetCacheNeeded,
        lastWsMsgAt: 0,
        lastDeliveredAt: Date.now(),
      }

      // WS first: the only source that carries the IN-PROGRESS candle (see
      // RealtimeCandleSource). `subscribed/candle` delivers an immediate
      // snapshot of the current bucket; `update/candle` streams per-trade
      // updates. Bucket times are ms and only ever move forward, so the
      // `>= lastBarTime` guard also keeps the slower REST poll from feeding
      // TradingView an older (closed) bar after WS has shown the live one.
      if (realtime) {
        const marketId = realtime.resolveMarketId(symbolInfo.name)
        if (marketId != null) {
          sub.wsUnsub = realtime.subscribe(
            `candle/${marketId}/${interval}`,
            (raw: unknown) => {
              const msg = raw as WsCandleMessage
              if (
                (msg.type === "subscribed/candle" ||
                  msg.type === "update/candle") &&
                msg.data
              ) {
                const d = msg.data
                sub.lastWsMsgAt = Date.now()
                const bar: Bar = {
                  time: d.t, // already ms
                  open: parseFloat(d.o),
                  high: parseFloat(d.h),
                  low: parseFloat(d.l),
                  close: parseFloat(d.c),
                  // Quote (USD) volume to match getBars' `qv` convention.
                  volume: parseFloat(d.V ?? d.v),
                }
                if (
                  Number.isFinite(bar.time) &&
                  Number.isFinite(bar.close) &&
                  bar.time >= sub.lastBarTime
                ) {
                  sub.lastBarTime = bar.time
                  sub.lastDeliveredAt = Date.now()
                  onTick(bar)
                }
              }
            }
          )
        }
      }

      // Poll the latest bar — fallback only: skipped while WS frames are
      // arriving (see WS_QUIET_MS). The in-flight flag stops ticks from
      // stacking on a slow response, and the lastBarTime check drops
      // out-of-order responses — feeding TradingView a bar older than the
      // last delivered one breaks the realtime stream.
      sub.timer = setInterval(async () => {
        if (sub.inFlight) return
        if (Date.now() - sub.lastWsMsgAt < WS_QUIET_MS) return
        sub.inFlight = true
        try {
          const bars = await fetchBars(market, interval, 2)
          const last = bars?.[bars.length - 1]
          if (last && last.time >= sub.lastBarTime) {
            sub.lastBarTime = last.time
            sub.lastDeliveredAt = Date.now()
            onTick(last)
          }
        } catch {
          /* transient poll errors are fine */
        } finally {
          sub.inFlight = false
        }
      }, 1000)
      subscriptions.set(subscriberUID, sub)
    },

    unsubscribeBars: (subscriberUID) => {
      const sub = subscriptions.get(subscriberUID)
      if (sub) {
        clearInterval(sub.timer)
        sub.wsUnsub?.()
        subscriptions.delete(subscriberUID)
      }
    },

    isStale: (maxAgeMs: number) => {
      const now = Date.now()
      for (const sub of subscriptions.values()) {
        if (now - sub.lastDeliveredAt > maxAgeMs) return true
      }
      return false
    },

    resetCache: () => {
      for (const sub of subscriptions.values()) {
        // Drop our own out-of-order guard so the next poll delivers freely...
        sub.lastBarTime = 0
        // ...restart the staleness clock so isStale() doesn't re-trigger a
        // backfill loop on a genuinely quiet market...
        sub.lastDeliveredAt = Date.now()
        // ...and tell the library to discard its cached bars for this series.
        try {
          sub.onResetCacheNeeded()
        } catch {
          /* callback may be gone if the series is tearing down */
        }
      }
    },

    dispose: () => {
      for (const sub of subscriptions.values()) {
        clearInterval(sub.timer)
        sub.wsUnsub?.()
      }
      subscriptions.clear()
    },
  }
}
