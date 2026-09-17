import { sendGAEvent } from "@next/third-parties/google"

// Centralized GA4 custom-event helpers.
//
// Every event funnels through `track()` so that:
//   • GA is a no-op wherever `NEXT_PUBLIC_GA_MEASUREMENT_ID` is unset (dev / v0
//     / staging) — `sendGAEvent` just calls `window.gtag`, which the layout
//     only injects on prod, so calling this off-prod is a harmless no-op.
//   • analytics can never break app flow — any throw is swallowed.
//
// Keeping the call sites thin (they call `trackWalletLogin(address)`, not raw
// `sendGAEvent`) means the wallet-address policy lives in ONE place: to later
// hash the address, truncate it, or drop it entirely, edit only this file.
function track(event: string, params: Record<string, unknown> = {}) {
  try {
    sendGAEvent("event", event, params)
  } catch {
    // never let analytics failures surface to the user
  }
}

/**
 * Fired on successful wallet login (after the backend `/auth/login` round-trip
 * sets the session cookies).
 *
 * NOTE: this sends the raw wallet address to GA. Wallet addresses are a
 * persistent, on-chain-linkable identifier — Google Analytics' terms prohibit
 * sending PII, and this is arguably PII. Before relying on this long-term,
 * prefer hashing the address into an anonymous `user_id`. Kept raw here per
 * product request; change the mapping below when revisiting.
 */
export function trackWalletLogin(address: string | undefined) {
  if (!address) return
  track("wallet_login", {
    // Strip the "0x" prefix before sending. gtag/GA coerce values that look
    // like a hex literal ("0x…") into a Number, so a raw address lands in the
    // reports as garbage like `1.15776e+48` (= Number("0x…")). Without the
    // prefix the 40-char hex string contains a–f letters, so GA can't parse it
    // as a number and stores it as text. Lowercased so one wallet never splits
    // across casings; re-add "0x" when reading the value back.
    wallet_address: address.toLowerCase().replace(/^0x/, ""),
  })
}

// Parse a human-readable amount string ("100.5") into a Number for GA, so the
// value can be summed/averaged as a custom metric instead of landing as an
// opaque text dimension. Returns undefined for junk so we never send NaN.
function toGANumber(value: string | number | undefined): number | undefined {
  if (value == null) return undefined
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Fired when a deposit is mined and server-acked (`/account/deposit` verify
 * resolved) — the moment the EL→EL$ conversion is locked in, before the
 * 15-confirmation crediting completes.
 */
export function trackDeposit(params: {
  /** wallet tokens deposited, e.g. EL ("10000") */
  amount: string
  /** EL$ credited after conversion (100 EL = 1 EL$) */
  elDollarAmount: number
  /** wallet token symbol, e.g. "EL" */
  token?: string
}) {
  track("deposit", {
    amount: toGANumber(params.amount),
    el_dollar_amount: toGANumber(params.elDollarAmount),
    token: params.token,
  })
}

/** Fired when `/account/withdraw` succeeds. `amount` is in EL$. */
export function trackWithdraw(params: { amount: string; token?: string }) {
  track("withdraw", {
    el_dollar_amount: toGANumber(params.amount),
    token: params.token,
  })
}

/**
 * Fired when `/perp/order` accepts an order. Size/price describe the order as
 * submitted (fills may settle later/partially — this tracks trading intent).
 */
export function trackTrade(params: {
  market: string
  /** "Long" | "Short" | "buy" | "sell" */
  side: string
  /** base-asset size, e.g. BTC ("0.5") */
  size: string
  price: string
  /** 0 = Limit, 1 = Market */
  orderType: 0 | 1
  reduceOnly?: boolean
}) {
  track("trade", {
    market: params.market,
    side: params.side.toLowerCase(),
    size: toGANumber(params.size),
    price: toGANumber(params.price),
    order_type: params.orderType === 0 ? "limit" : "market",
    reduce_only: params.reduceOnly ? "true" : "false",
  })
}
