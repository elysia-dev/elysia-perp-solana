import { create } from "zustand"

/**
 * Per-market trading mode (ELP-499, server PR #887).
 *
 * FX-session markets (USDKRW-PERP-USDT) are not 24/7: outside NY trading
 * hours they flip to `reduce_only`, and on an oracle fault (or right after
 * open, before the first fresh price) to `halted`. Ordinary crypto markets
 * are always `active` — the server broadcasts that too, so absence from
 * this map simply means "no market_stats frame seen yet".
 *
 *   active      — everything allowed
 *   reduce_only — only position-reducing orders (no new entries/increases)
 *   halted      — no new/amended orders at all (cancel only); mark_price
 *                 from the same frame must not be trusted
 *
 * Written from two sources, WS being authoritative once connected:
 *   1. REST GET /markets/{market}/oracle — one-shot seed on mount
 *      (useMarketMode) so the UI doesn't flash "active" before WS lands.
 *   2. WS market_stats/{market_id} frames (useMarkPriceSync) — pushed every
 *      second, so reconnect gaps self-heal without extra polling.
 */
export type MarketMode = "active" | "reduce_only" | "halted"

export function isMarketMode(v: unknown): v is MarketMode {
  return v === "active" || v === "reduce_only" || v === "halted"
}

interface MarketModeState {
  /** market_id → mode. Missing key = unknown (treat as active). */
  modes: Record<number, MarketMode>
  setMode: (marketId: number, mode: MarketMode) => void
}

export const useMarketModeStore = create<MarketModeState>()((set) => ({
  modes: {},
  setMode: (marketId, mode) =>
    set((s) =>
      // market_stats pushes every second — skip the no-op update so
      // subscribed components don't re-render 1×/s for an unchanged mode.
      s.modes[marketId] === mode
        ? s
        : { modes: { ...s.modes, [marketId]: mode } }
    ),
}))
