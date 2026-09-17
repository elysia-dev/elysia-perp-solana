export type PerpOrderSide = "Long" | "Short" | "buy" | "sell"

// API uses is_ask: bool. Mapping: is_ask=true → Short/Ask, is_ask=false → Long/Bid
export const isAskToSide = (isAsk: boolean): "Long" | "Short" =>
  isAsk ? "Short" : "Long"
export const sideToIsAsk = (side: PerpOrderSide): boolean =>
  side === "Short" || side === "sell"
export type PerpMarginMode = "isolated" | "cross"
export type PerpOrderType = "Limit" | "Market"
// API order type: 0 = Limit, 1 = Market
export type PerpOrderTypeNumeric = 0 | 1
export type PerpOrderStatus = "placed" | "partial" | "filled" | "cancelled"
export type PositionAction = "open" | "increase" | "decrease" | "close" | "flip"

// Raw API response — backend sends side: "Long"/"Short" directly
// Also supports legacy is_ask: boolean for backwards compatibility
/**
 * Order types as they appear in ORDER HISTORY. On top of user-placed
 * Limit/Market, the engine writes synthetic "Liquidation" close orders
 * (server persist/worker.rs — liquidation cascades archive an order row).
 * Form state keeps the narrower PerpOrderType.
 */
export type PerpOrderRecordType = PerpOrderType | "Liquidation"

export interface PerpOrderRaw {
  id: number
  market: string
  side?: "Long" | "Short"
  is_ask?: boolean
  order_type: PerpOrderRecordType
  price: string
  initial_base_amount: string
  filled_base_amount: string
  remaining_base_amount: string
  reduce_only: boolean
  status: PerpOrderStatus
  created_at: string
}

// Frontend model
export interface PerpOrder extends Omit<PerpOrderRaw, "is_ask" | "side"> {
  side: "Long" | "Short"
}

export function toPerpOrder(raw: PerpOrderRaw): PerpOrder {
  const { is_ask: isAsk, side, ...rest } = raw
  // Prefer side field (backend sends "Long"/"Short" directly)
  // Fall back to is_ask for backwards compatibility
  const resolvedSide: "Long" | "Short" = side ?? isAskToSide(isAsk ?? false)
  return { ...rest, side: resolvedSide }
}

export interface PerpOrdersRawResponse {
  orders: PerpOrderRaw[]
}

export interface PerpOrdersResponse {
  orders: PerpOrder[]
}

export interface PlacePerpOrderRequest {
  market: string
  side: PerpOrderSide
  is_ask: boolean
  price: string
  size: string
  base_amount: string
  order_type: PerpOrderTypeNumeric
  reduce_only?: boolean
  margin_mode: number // Always 1 (Isolated only)
}

export interface PlacePerpOrderResponse {
  order_id: number
  market: string
  status: PerpOrderStatus
  price: string
  initial_base_amount: string
  filled_base_amount: string
  remaining_base_amount: string
  margin_delta: string
  position_action: string
}

export interface CancelPerpOrderRequest {
  order_id: number
  market: string
}

export interface CancelPerpOrderResponse {
  order_id: number
  status: "cancelled"
  margin_released: string
}

export interface CancelAllPerpOrdersRequest {
  market?: string
}

export interface CancelAllPerpOrdersResponse {
  cancelled_count: number
  total_margin_released: string
  cancelled_orders: {
    order_id: number
    market: string
    margin_released: string
  }[]
}

export interface MarkPriceResponse {
  symbol: string
  mark_price: string
  index_price: string
  open_interest?: string
  daily_volume?: string
  daily_base_volume?: string
  daily_change?: string
  daily_high?: string
  daily_low?: string
  funding_rate?: string
  funding_cap_1hr?: string
  updated_at: string
}

// Leverage API
export interface UpdateLeverageRequest {
  market: string
  initial_margin_fraction: number // IMF value (500 ~ 10000)
  margin_mode: number // Always 1 (Isolated only)
}

export interface UpdateLeverageResponse {
  market: string
  initial_margin_fraction: number
  margin_mode: number
}

// IMF ↔ Leverage conversion helpers
export const leverageToIMF = (leverage: number): number =>
  Math.floor(10000 / leverage)
export const imfToLeverage = (imf: number): number => 10000 / imf

// OrderBook Details API
export interface OrderBookDetail {
  symbol: string
  market_id: number
  market_type: string
  base_asset_id: number
  quote_asset_id: number
  status: string
  taker_fee: string
  maker_fee: string
  liquidation_fee: string
  size_decimals: number
  price_decimals: number
  quote_decimals: number
  default_initial_margin_fraction: number
  min_initial_margin_fraction: number
  maintenance_margin_fraction: number
}

export interface OrderBookDetailsResponse {
  code: number
  order_book_details: OrderBookDetail[]
}
