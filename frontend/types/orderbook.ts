export type OrderSide = "bid" | "ask"

export interface Orderbook {
  bids: OrderEntry[]
  asks: OrderEntry[]
}

export interface OrderEntry {
  price: string
  size: string
  orders: string
}

export interface CreateOrderRequest {
  market_id: number
  side: OrderSide
  price: number
  size: number
}

export interface CreateOrderResponse {
  order_id: number
}

export interface CancelOrderRequest {
  order_id: number
  market_id: number
  side: OrderSide
}

export interface Order {
  id: number
  market: string
  side: OrderSide
  price: string
  initial_base_amount: string
  filled_base_amount: string
  remaining_base_amount: string
  status: string
  created_at: string
}

export interface OrdersResponse {
  address: string
  orders: Order[]
}

export interface OrderHistoryResponse {
  address: string
  orders: Order[]
}

export type TradingOrderType = "Limit" | "Market"
