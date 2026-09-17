import { create } from "zustand"
import type { Position } from "@/types"

/**
 * Which position the Close-Position modal should open for. Lifted into a store
 * so both the Positions table's Close button and the chart's on-line close (X)
 * button open the single modal instance (ClosePositionModalHost on the trade
 * page, which resolves this request to the LIVE position row). `null` = closed.
 */
interface ClosePositionModalState {
  position: Position | null
  requestClose: (position: Position) => void
  clear: () => void
}

export const useClosePositionModal = create<ClosePositionModalState>((set) => ({
  position: null,
  requestClose: (position) => set({ position }),
  clear: () => set({ position: null }),
}))
