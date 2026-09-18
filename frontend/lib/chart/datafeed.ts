// Candle source for the lightweight-charts chart, backed by Elysia's OHLCV
// server (`/candle-api/markets/{market}/candles`) with realtime candles from
// the app's shared WebSocket. Plain functions — no charting-library types.

import type { UTCTimestamp } from "lightweight-charts"

// Single source of truth for the resolutions the chart supports. The interval
// switcher, backend interval string, and candle bucket size all derive from
// this table.
const RESOLUTIONS = [
  { resolution: "1", label: "1m", interval: "1m", ms: 60_000 },
  { resolution: "5", label: "5m", interval: "5m", ms: 300_000 },
  { resolution: "15", label: "15m", interval: "15m", ms: 900_000 },
  { resolution: "60", label: "1h", interval: "1h", ms: 3_600_000 },
  { resolution: "240", label: "4h", interval: "4h", ms: 14_400_000 },
  { resolution: "1D", label: "1D", interval: "1d", ms: 86_400_000 },
] as const

export type ResolutionValue = (typeof RESOLUTIONS)[number]["resolution"]

/** Resolution options for the interval switcher UI. */
export const RESOLUTION_OPTIONS = RESOLUTIONS.map((r) => ({
  resolution: r.resolution,
  label: r.label,
}))

/** Backend interval string ("15m") for a chart resolution ("15"). */
export function resolutionToInterval(resolution: string): string {
  return RESOLUTIONS.find((r) => r.resolution === resolution)?.interval ?? "15m"
}

/** Candle bucket size (ms) for a resolution. */
export function resolutionToMs(resolution: string): number {
  return RESOLUTIONS.find((r) => r.resolution === resolution)?.ms ?? 900_000
}

/** Strip the collateral suffix: "BTC-PERP-EL" → "BTC-PERP". */
export function toBaseSymbol(market: string): string {
  const marker = "-PERP"
  const idx = market.indexOf(marker)
  return idx === -1 ? market : market.slice(0, idx + marker.length)
}

/** A candle in lightweight-charts terms (time in UNIX seconds). */
export interface Candle {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
  /** Quote (USD) volume for the volume pane. */
  volume: number
}

interface RawCandle {
  t: number // UNIX seconds
  o: string
  h: string
  l: string
  c: string
  v: string // base volume
  qv?: string // quote (USD) volume
}
interface CandleServerResponse {
  candles?: RawCandle[]
}

/**
 * Per-bar quote (USD) volume for the volume pane. The server's `qv` is
 * preferred, but the ohlcv-server has shipped it 10× too small on some
 * deploys — so sanity-check it against the close×size approximation and only
 * trust `qv` when the two agree within 2×; otherwise fall back to close×size.
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

/** Abort signal with a fallback for browsers without `AbortSignal.timeout`. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/**
 * Fetch candles for a market. Returns:
 * - `Candle[]` (possibly empty) — server recognised the market.
 * - `null` — transport/HTTP failure (retryable).
 * The candle server keys markets by the FULL name ("BTC-PERP-EL"); the base
 * form returns 400.
 */
export async function fetchCandles(
  market: string,
  interval: string,
  limit: number,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const params = new URLSearchParams({ interval, limit: String(limit) })
  if (endTimeSec) params.set("endTime", String(endTimeSec))

  try {
    const res = await fetch(
      `/candle-api/markets/${encodeURIComponent(market)}/candles?${params}`,
      { cache: "no-store", signal: timeoutSignal(8_000) }
    )
    if (!res.ok) return null
    const json: CandleServerResponse = await res.json()
    return (json.candles ?? []).map((c) => ({
      time: c.t as UTCTimestamp, // candle-api seconds = lightweight-charts time
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

/** Realtime candle source wired to the app's shared WebSocket. Only the WS
 *  carries the IN-PROGRESS candle — the REST API serves closed candles only. */
export interface RealtimeCandleSource {
  /** WebSocketProvider's subscribe: registers a handler, returns unsubscribe. */
  subscribe: (channel: string, handler: (msg: unknown) => void) => () => void
  /** Backend numeric market_id for the WS channel. */
  resolveMarketId: (symbol: string) => number | null | undefined
}

/**
 * Subscribe to realtime candles for (symbol, interval). Calls `onCandle` with
 * each live bar (snapshot on subscribe + per-trade updates). Returns an
 * unsubscribe fn; no-op when the market id can't be resolved.
 */
export function subscribeRealtimeCandles(
  source: RealtimeCandleSource,
  symbol: string,
  marketName: string,
  interval: string,
  onCandle: (c: Candle) => void
): () => void {
  const marketId = source.resolveMarketId(marketName)
  if (marketId == null) return () => {}
  return source.subscribe(`candle/${marketId}/${interval}`, (raw: unknown) => {
    const msg = raw as WsCandleMessage
    if (
      (msg.type === "subscribed/candle" || msg.type === "update/candle") &&
      msg.data
    ) {
      const d = msg.data
      const c: Candle = {
        time: Math.floor(d.t / 1000) as UTCTimestamp, // ms → seconds
        open: parseFloat(d.o),
        high: parseFloat(d.h),
        low: parseFloat(d.l),
        close: parseFloat(d.c),
        volume: parseFloat(d.V ?? d.v),
      }
      if (Number.isFinite(c.time as number) && Number.isFinite(c.close)) {
        onCandle(c)
      }
    }
  })
}
