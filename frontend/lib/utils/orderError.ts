import { ApiError } from "@/lib/api/client"

/**
 * Maps a backend order/trade error into a friendly, user-facing reason string.
 *
 * Why this exists (frontend-only error tidy-up):
 * - The Rust backend returns order failures as a plain `{ "error": <string> }`
 *   body with NO stable machine `code` (only *auth* errors carry a `code`).
 *   So order errors can only be matched on the message text.
 * - Worse, the engine wraps the real message in Rust's `Debug` form, e.g.
 *   `BadRequest("insufficient margin: user_id 103, required 1121030, available 678343")`.
 *   We strip that wrapper before matching/showing.
 * - Numeric values are protocol-scaled. Notional/margin values use
 *   NOTIONAL_SCALE = 10^6 (= $1), so `required 1121030` means ≈1.12.
 *
 * Anything we don't recognise falls back to the unwrapped raw message, so a
 * new/rare backend error is never hidden — just shown verbatim.
 *
 * Covers the full perp error set in `processors/src/error.rs`
 * (PerpRiskEngineError) plus the handler-level BadRequests.
 */

// 10^6 = $1, protocol-wide notional/margin scale (see backend `processors`).
const NOTIONAL_SCALE = 1_000_000

/** Strip a Rust enum Debug wrapper like `BadRequest("...")` → inner text. */
function unwrap(message: string): string {
  const m = message.match(/^[A-Za-z]+\("([\s\S]*)"\)$/)
  return (m ? m[1] : message).trim()
}

/** Render a NOTIONAL_SCALE-scaled integer as a human amount (e.g. 1121030 → "1.12"). */
function fromNotional(scaled: string): string {
  const v = Number(scaled) / NOTIONAL_SCALE
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

export function toOrderErrorReason(err: unknown): string {
  // Auth errors DO carry a stable code — match those first.
  const code = err instanceof ApiError ? err.code : undefined
  if (code === "MISSING_AUTH_COOKIE")
    return "Session expired. Please sign in again."
  if (code === "NETWORK_ERROR" || code === "REFRESH_FAILED")
    return "Network error. Check your connection and try again."

  // Market-mode rejections (ELP-499, FX-session markets like USDKRW).
  // These are stable `reason` codes from the server — the UI also gates
  // proactively via useMarketMode, but the server response is the final
  // judge (the ticket's explicit guidance), so both codes get friendly copy.
  if (code === "MARKET_HALTED")
    return "Trading is halted — waiting for a fresh oracle price. Only cancellations are accepted right now."
  if (code === "MARKET_REDUCE_ONLY")
    return "Market is closed (FX session). Only reduce-only orders are accepted until it reopens."

  const raw = err instanceof Error ? err.message : ""
  const msg = unwrap(raw)

  // insufficient margin: user_id X, required R, available A  (R/A are scaled)
  const margin = msg.match(
    /insufficient margin:.*required\s+(\d+),\s*available\s+(\d+)/i
  )
  if (margin)
    return `Insufficient margin (need ≈${fromNotional(margin[1])} EL, have ≈${fromNotional(
      margin[2]
    )} EL). Reduce size, raise leverage, or deposit more.`

  // insufficient collateral to re-lock open orders at lower leverage
  // (user=U, market=M, extra_required=R, available=A)  (R/A are scaled) —
  // lowering max leverage re-locks open orders' margin at the new ratio.
  const relock = msg.match(
    /insufficient collateral to re-lock open orders.*extra_required=(\d+).*available=(\d+)/i
  )
  if (relock)
    return `Not enough collateral to lower leverage with open orders (≈${fromNotional(
      relock[1]
    )} EL more needed, ≈${fromNotional(
      relock[2]
    )} EL available). Cancel some orders or deposit more.`
  if (/insufficient collateral to re-lock open orders/i.test(msg))
    return "Not enough collateral to lower leverage with open orders. Cancel some orders or deposit more."

  // invalid order arguments: price P, size S  → almost always the order value
  // (price × size) is below the $1 minimum notional (MIN_NOTIONAL_DOLLARS).
  if (/invalid order arguments/i.test(msg))
    return "Order value is below the $1 minimum. Increase the amount."

  // invalid leverage: L. Must be MIN-MAX
  const lev = msg.match(/invalid leverage:.*must be\s+(-?\d+)-(-?\d+)/i)
  if (lev) return `Invalid leverage. Must be between ${lev[1]} and ${lev[2]}.`

  // reduce_only family
  if (
    /reduce_only order .*no existing position|reduce_only order requires an existing position/i.test(
      msg
    )
  )
    return "No open position to reduce."
  if (/reduce_only order would increase position/i.test(msg))
    return "Reduce-only orders can't increase your position."
  if (/reduce_only order size .*exceeds position size/i.test(msg))
    return "Reduce-only size exceeds your current position."

  // notional / OI / order-count caps
  if (/order quote notional|exceeds market .* limit/i.test(msg))
    return "Order value exceeds this market's per-order limit."
  if (/open interest cap exceeded/i.test(msg))
    return "Market open-interest cap reached. Try a smaller size or later."
  if (/maximum open orders/i.test(msg))
    return "Too many open orders in this market. Cancel some first."

  // settlement / liquidity
  if (/margin shortfall during settlement/i.test(msg))
    return "Couldn't fill at the available price (margin shortfall). Try a smaller size or a limit order."
  if (/insufficient liquidity|no liquidity/i.test(msg))
    return "Not enough liquidity to fill at market. Try a smaller size or a limit order."

  // market / price feed
  if (/unknown market|market specification not found/i.test(msg))
    return "This market isn't available right now."
  if (/mark price not available/i.test(msg))
    return "Price feed unavailable. Please try again shortly."

  // Fallback: show the cleaned (unwrapped) message, or a generic line.
  return msg || "Order failed. Please try again."
}
