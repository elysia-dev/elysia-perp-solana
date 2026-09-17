export interface UserBalance {
  address: string
  balances: Balance[]
}

export type RouteType = "perp" | "spot"

export interface Balance {
  asset_id: number
  route_type: RouteType
  available: string
  locked: string
}

export interface SetBalanceRequest {
  user_id: number
  asset_id: number
  balance: number
}
