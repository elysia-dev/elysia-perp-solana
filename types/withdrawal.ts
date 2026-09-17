export type WithdrawalStatus =
  | "pending"
  | "pending_approval"
  | "submitted"
  | "confirmed"
  | "denied"
  | "refunded"

export interface Withdrawal {
  id: number
  token_address: string
  asset_id: number
  amount: string
  status: WithdrawalStatus
  tx_hash: string | null
  route_type: string
  created_at: string
}

export interface WithdrawalHistoryResponse {
  withdrawals: Withdrawal[]
}
