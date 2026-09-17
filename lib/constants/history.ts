import type { TabValue } from "@/types/history"

export const HISTORY_TABS: { value: TabValue; label: string }[] = [
  { value: "positions", label: "Positions" },
  { value: "assets", label: "Assets" },
  { value: "open-orders", label: "Open Orders" },
  { value: "order-history", label: "Order History" },
  { value: "trade-history", label: "Trade History" },
  { value: "funding-history", label: "Funding History" },
]
