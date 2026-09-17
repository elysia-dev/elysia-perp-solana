export type Pair = {
  id: number
  name: string
  market_type: string
  base: string
  base_scale_k: number
  taker_fee: number
  maker_fee: number
  quote: string
  quote_scale_k: number
  base_currency: number
  quote_currency: number
}

export interface Market {
  market_id: number
  name: string
  market_type: string
  base_currency: number
  quote_currency: number
  base_scale_k: number
  quote_scale_k: number
  taker_fee: number
  maker_fee: number
}
