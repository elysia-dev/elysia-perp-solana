import { create } from "zustand"
import type { MarkPriceResponse } from "@/types"

interface MarkPriceState {
  /** symbol → MarkPriceResponse */
  markPrices: Map<string, MarkPriceResponse>
  /**
   * Per-symbol patch — preferred over `setMarkPrices`. Updates exactly one
   * entry and produces a new Map reference so Zustand notices the change,
   * but every other entry keeps its previous object reference. That means
   * `selectMarkPriceData(otherSymbol)` returns the same object across the
   * update and the per-symbol subscriber's `Object.is` equality check
   * bails out — no re-render for unrelated symbols.
   */
  setMarkPrice: (symbol: string, data: MarkPriceResponse) => void
  /**
   * Drop entries whose symbol is not in `keep`. Used by useMarkPriceSync
   * on unmount so the store doesn't accumulate stale rows.
   */
  pruneMarkPrices: (keep: Set<string>) => void
  /**
   * Bulk replace — kept for backwards compatibility but new callers should
   * use `setMarkPrice` per symbol. Bulk replace forces a re-evaluation in
   * every subscribed selector; per-symbol set bypasses that for unrelated
   * symbols (see comment on setMarkPrice).
   */
  setMarkPrices: (prices: Map<string, MarkPriceResponse>) => void
}

export const useMarkPriceStore = create<MarkPriceState>((set) => ({
  markPrices: new Map(),
  setMarkPrice: (symbol, data) =>
    set((state) => {
      // Construct a new Map so Zustand sees a reference change, but leave
      // every other entry's value reference untouched. Per-symbol selectors
      // will re-run but their `Object.is` check on the unchanged entries
      // returns true → those subscribers don't re-render.
      const next = new Map(state.markPrices)
      next.set(symbol, data)
      return { markPrices: next }
    }),
  pruneMarkPrices: (keep) =>
    set((state) => {
      if (state.markPrices.size <= keep.size) {
        // Cheap check: if there's nothing to prune, avoid forcing a re-render.
        let allKept = true
        for (const k of state.markPrices.keys()) {
          if (!keep.has(k)) {
            allKept = false
            break
          }
        }
        if (allKept) return state
      }
      const next = new Map<string, MarkPriceResponse>()
      for (const [k, v] of state.markPrices) {
        if (keep.has(k)) next.set(k, v)
      }
      return { markPrices: next }
    }),
  setMarkPrices: (prices) => set({ markPrices: prices }),
}))

// Selector: get mark price number for a symbol, returns 0 if not found
export function selectMarkPrice(symbol: string) {
  return (state: MarkPriceState): number => {
    const data = state.markPrices.get(symbol)
    return data?.mark_price ? parseFloat(data.mark_price) : 0
  }
}

// Selector: get full MarkPriceResponse for a symbol
export function selectMarkPriceData(symbol: string) {
  return (state: MarkPriceState): MarkPriceResponse | undefined =>
    state.markPrices.get(symbol)
}
