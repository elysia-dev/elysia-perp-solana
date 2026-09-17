/**
 * Display label for a server market name — "BTC-PERP-EL" → "BTC-EL".
 *
 * Server market names are API keys and never change; DISPLAY bases can.
 * SPY trades as SPY-PERP-EL on the engine but is presented as "US500"
 * everywhere in the UI (design 2026-09-08), so the base is mapped here —
 * the one place every history tab, modal, and toast resolves labels from.
 */
const BASE_DISPLAY_OVERRIDES: Record<string, string> = {
  SPY: "US500",
}

export function marketDisplayLabel(market: string): string {
  const stripped = market.replace("-PERP", "")
  const [base, ...rest] = stripped.split("-")
  const mapped = BASE_DISPLAY_OVERRIDES[base] ?? base
  return [mapped, ...rest].join("-")
}
