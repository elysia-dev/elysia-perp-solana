import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface PendingDeposit {
  txHash: string
  amount: string
  depositBlock: number
  timestamp: number
  /**
   * Chain the deposit tx landed on. Optional because persisted entries from
   * before multi-chain confirmations exist without it — readers must fall
   * back to the default (15-confirmation) policy when absent.
   */
  chainId?: number
}

interface PendingDepositState {
  deposits: PendingDeposit[]
  addDeposit: (deposit: PendingDeposit) => void
  removeDeposit: (txHash: string) => void
}

export const usePendingDepositStore = create<PendingDepositState>()(
  persist(
    (set) => ({
      deposits: [],
      addDeposit: (deposit) =>
        set((state) => ({
          deposits: [...state.deposits, deposit],
        })),
      removeDeposit: (txHash) =>
        set((state) => ({
          deposits: state.deposits.filter((d) => d.txHash !== txHash),
        })),
    }),
    { name: "pending-deposits" }
  )
)
