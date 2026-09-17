export type TradeRole = "maker" | "taker"

export type TradeAction =
  | "Open Long"
  | "Open Short"
  | "Close Long"
  | "Close Short"

export interface Trade {
  id: number
  market: string
  price: string
  size: string
  usd_amount: string
  trade_type: string
  is_maker_ask: boolean
  maker_account_id?: number
  taker_account_id?: number
  taker_order_id: number
  maker_order_id: number
  taker_fee: string
  maker_fee: string
  taker_position_size_before: string
  taker_entry_quote_before: string
  taker_initial_margin_fraction_before: number
  taker_position_sign_changed: boolean
  maker_position_size_before: string
  maker_entry_quote_before: string
  maker_initial_margin_fraction_before: number
  maker_position_sign_changed: boolean
  created_at: string
}

export interface TradesResponse {
  address: string
  trades: Trade[]
}
