import { create } from "zustand"
import { DEFAULT_ECOSYSTEM_ID } from "@/lib/config/markets"

interface EcosystemState {
  selectedId: string
  setSelectedId: (id: string) => void
}

export const useEcosystemStore = create<EcosystemState>((set) => ({
  selectedId: DEFAULT_ECOSYSTEM_ID,
  setSelectedId: (id) => set({ selectedId: id }),
}))
