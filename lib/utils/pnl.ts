/**
 * Unrealized PnL for a position at a given mark price.
 *
 * Long  → (mark - entry) × size
 * Short → (entry - mark) × size, i.e. multiply by -1
 *
 * Computed client-side so the value ticks with every WS mark price update
 * instead of waiting for the next /account refetch.
 */
export function computeUnrealizedPnl(args: {
  side: "Long" | "Short"
  entryPrice: number
  size: number
  markPrice: number
}): number {
  const { side, entryPrice, size, markPrice } = args
  const directional = side === "Long" ? 1 : -1
  return (markPrice - entryPrice) * size * directional
}

/** ROE (%) given pnl and the position's margin. Returns 0 for invalid margin. */
export function computeRoePercent(pnl: number, margin: number): number {
  if (!Number.isFinite(margin) || margin <= 0) return 0
  return (pnl / margin) * 100
}
