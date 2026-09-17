/**
 * Scaling constants that mirror the backend's `common::scaling` module.
 *
 * The backend stores fractional quantities as integer "ticks" to avoid
 * floating-point drift across the matching engine. Anything the API exposes
 * in those tick units needs to be converted before display.
 *
 * Keep these in sync with `common/src/scaling.rs` on the backend.
 */

/** Funding rate denominator: 1 tick = 0.0001%. */
export const FUNDING_RATE_TICK = 1_000_000

/** Margin / IMF / MMF denominator: 1 tick = 0.01%. */
export const MARGIN_TICK = 10_000

/** Fee denominator: 1 tick = 0.0001%. */
export const FEE_TICK = 1_000_000

/**
 * Maintenance Margin Fraction (ticks). Backend constant — when this changes
 * we need a release. 250 ticks = 2.5% of position value.
 *
 * NOTE: Prefer reading `OrderBookDetail.maintenance_margin_fraction` from
 * the API when available; use this only as a fallback.
 */
export const MMF_TICKS = 250

/** Convenience: MMF as a 0-1 fraction (e.g. 0.025 for 2.5%). */
export const MMF_FRACTION = MMF_TICKS / MARGIN_TICK
