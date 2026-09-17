import type { MarkPriceResponse } from "@/types"

/**
 * Pick the freshest mark price from an already-resolved entry, falling
 * back to a snapshot value (e.g. `position.mark_price` from /account) when
 * the WS stream hasn't delivered one yet.
 *
 * Prefer this overload when the caller has subscribed to a single symbol
 * via the per-symbol selector — passing the whole `markPrices` Map forces
 * a re-render on every tick of every other symbol.
 *
 * Returns `0` if neither source has a positive number — callers should
 * treat that as "unknown" rather than a real price.
 */
export function resolveLiveMarkPriceFromData(
  data: MarkPriceResponse | undefined,
  fallback: string | number = 0
): number {
  const live = data?.mark_price
  const liveNum = live != null && live !== "" ? parseFloat(live) : NaN
  if (Number.isFinite(liveNum) && liveNum > 0) return liveNum
  const fb = typeof fallback === "number" ? fallback : parseFloat(fallback)
  return Number.isFinite(fb) && fb > 0 ? fb : 0
}

/**
 * Map-based overload — keep around for callers that genuinely iterate
 * many symbols (e.g. AssetsTab walking every open position).
 */
export function resolveLiveMarkPrice(
  markPrices: Map<string, MarkPriceResponse>,
  symbol: string,
  fallback: string | number = 0
): number {
  return resolveLiveMarkPriceFromData(markPrices.get(symbol), fallback)
}
