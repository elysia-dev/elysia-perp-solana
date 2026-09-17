export type DepositStatus = "pending" | "confirmed"

export interface Deposit {
  id: number
  tx_hash: string
  token_address: string
  amount: string
  status: DepositStatus
  route_type: string
  created_at: string
}

export interface DepositHistoryResponse {
  deposits: Deposit[]
}

export interface VerifyDepositResponse {
  status: string
  message: string
  deposit?: Deposit
}
