import type { OrderBookDetail, Position } from "@/types"
import { MARGIN_TICK, MMF_FRACTION } from "@/lib/constants/scaling"

/**
 * Resolve the maintenance margin fraction (0..1) for a market.
 * Prefers the per-market value the backend exposes on `OrderBookDetail`;
 * falls back to the global constant.
 */
export function mmfFractionOf(
  detail: OrderBookDetail | undefined | null
): number {
  const ticks = detail?.maintenance_margin_fraction
  if (ticks == null || ticks <= 0) return MMF_FRACTION
  return ticks / MARGIN_TICK
}

/**
 * Estimate liquidation price using the same formula the backend uses
 * (mirrors `common::position::margin`):
 *
 *   positionValue = size × markPrice
 *   mm            = positionValue × mmf
 *   equity        = margin + unrealizedFunding
 *   Long  → entry - (equity - mm) / size
 *   Short → entry + (equity - mm) / size
 *
 * `unrealizedFunding` mirrors the liquidation engine, which settles equity as
 * `margin + unrealized_pnl + unrealized_funding` (see ELP-321). Pass the
 * position's `funding_pnl` (signed; negative = paying) so the preview matches
 * the real liquidation point. Defaults to 0 for pre-trade previews (a brand-new
 * order has no accrued funding yet).
 *
 * Returns 0 when inputs are invalid (size ≤ 0).
 *
 * For pre-trade previews use `markPrice = entryPrice` (the order's
 * intended fill price) — that's the best information we have before
 * the trade executes.
 */
export function computeLiquidationPrice(args: {
  side: "Long" | "Short"
  entryPrice: number
  size: number
  margin: number
  markPrice: number
  mmf: number
  unrealizedFunding?: number
}): number {
  const { side, entryPrice, size, margin, markPrice, mmf } = args
  const unrealizedFunding = args.unrealizedFunding ?? 0
  if (size <= 0) return 0
  const positionValue = size * markPrice
  const mm = positionValue * mmf
  const delta = (margin + unrealizedFunding - mm) / size
  return side === "Long" ? entryPrice - delta : entryPrice + delta
}

/**
 * Funding-aware liquidation price for an OPEN position, displayed in the
 * Positions tab / chart / Modify-Margin "current" row.
 *
 * The backend `position.liquidation_price` omits unrealized funding, but the
 * liquidation engine includes it. Since funding only shifts the price by
 * `funding / size` (the maintenance-margin term cancels), we correct the
 * backend value directly — no MMF needed — keeping it anchored to the server's
 * formula:
 *   Long  → liq - funding / size
 *   Short → liq + funding / size
 * `funding_pnl` is the exact value the engine uses for the liquidation check
 * (both call `calc_funding_settlement`), so this resolves to the real
 * liquidation point. See ELP-321. Falls back to the raw backend value when
 * inputs are missing.
 */
export function positionLiquidationPrice(position: Position): number {
  const liq = parseFloat(position.liquidation_price)
  const size = parseFloat(position.size)
  const funding = parseFloat(position.funding_pnl)
  if (!(liq > 0) || !(size > 0) || !Number.isFinite(funding)) return liq
  const shift = funding / size
  return position.side === "Long" ? liq - shift : liq + shift
}
