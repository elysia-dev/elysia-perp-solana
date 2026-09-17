import { create } from "zustand"
import type { TabValue } from "@/types/history"

interface HistoryTabState {
  activeTab: TabValue
  setActiveTab: (tab: TabValue) => void
}

export const useHistoryTabStore = create<HistoryTabState>()((set) => ({
  activeTab: "positions",
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
