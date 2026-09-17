export interface Position {
  id: number
  market: string
  /** Quote token the position is denominated in (multi-token, ELP-133). */
  quote_asset_id: number
  side: "Long" | "Short"
  size: string
  entry_price: string
  mark_price: string
  margin: string
  leverage: string
  unrealized_pnl: string
  roe: string
  liquidation_price: string
  funding_pnl: string
  created_at: string
}

export interface PositionsResponse {
  positions: Position[]
}

export type OrderType = "Market" | "Limit"
// API order type: 0 = Limit, 1 = Market
export type OrderTypeNumeric = 0 | 1

export interface ClosePositionRequest {
  market: string
  side: "Long" | "Short"
  is_ask: boolean
  price: string
  size: string
  base_amount: string
  order_type: OrderTypeNumeric
  reduce_only: true
  margin_mode: number // Always 1 (Isolated only)
}

export interface ClosePositionResponse {
  order_id: number
  market: string
  status: string
  price: string
  initial_base_amount: string
  filled_base_amount: string
  remaining_base_amount: string
  margin_delta: string
  position_action: string
}
