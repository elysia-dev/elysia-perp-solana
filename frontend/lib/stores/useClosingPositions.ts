import { create } from "zustand"

/**
 * Markets with a close order in flight — set on mutate, cleared on error or
 * after a settle-window timeout. Drives the "Closing…" badge on the Positions
 * table.
 *
 * Why a badge instead of optimistically removing the row: the close POST
 * resolves on order ACCEPT, but the position only leaves /account once the
 * fill settles (~0.5–2s later) — and a market close can PARTIALLY fill on a
 * thin book, in which case the (smaller) row must stay. The badge is honest
 * about both outcomes; the timeout clears it when a partial close leaves the
 * row behind.
 */
interface ClosingPositionsState {
  closing: Record<string, true>
  markClosing: (market: string) => void
  clearClosing: (market: string) => void
}

export const useClosingPositions = create<ClosingPositionsState>((set) => ({
  closing: {},
  markClosing: (market) =>
    set((s) => ({ closing: { ...s.closing, [market]: true } })),
  clearClosing: (market) =>
    set((s) => {
      if (!(market in s.closing)) return s
      const next = { ...s.closing }
      delete next[market]
      return { closing: next }
    }),
}))
