export type TabValue =
  | "positions"
  | "assets"
  | "open-orders"
  | "order-history"
  | "trade-history"
  | "funding-history"
  | "deposits"
  | "withdrawals"

export type SideFilter = "all" | "bid" | "ask"

export type PerpSideFilter = "all" | "Long" | "Short"

export type PerpTypeFilter =
  | "all"
  | "limit"
  | "market"
  | "sl_market"
  | "sl_limit"
  | "tp_market"
  | "tp_limit"
