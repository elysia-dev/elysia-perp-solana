export interface AccountPosition {
  market_id: number
  symbol: string
  /** Quote token the position is collateralized/denominated in (multi-token, ELP-133). */
  quote_asset_id: number
  initial_margin_fraction: string
  open_order_count: number
  sign: number
  position: string
  avg_entry_price: string
  position_value: string
  unrealized_pnl: string
  realized_pnl: string
  liquidation_price: string
  margin_mode: number
  allocated_margin: string
  funding_pnl: string
}

/**
 * Per-token balance entry on an account. Multi-token (ELP-133): the server
 * returns one entry per registered deposit token (even when the balance is 0).
 * `available` / `locked` are decimal strings (NOTIONAL_DECIMALS = 6dp).
 */
export interface TokenBalance {
  asset_id: number
  available: string
  locked: string
}

export interface Account {
  account_type: number
  index: number
  l1_address: string
  total_order_count: number
  balances: TokenBalance[]
  positions: AccountPosition[]
}

export interface AccountResponse {
  code: number
  total: number
  accounts: Account[]
}
