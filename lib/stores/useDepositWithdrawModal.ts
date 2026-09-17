import { create } from "zustand"

/**
 * Open state for the Deposit / Withdraw modals. Lifted into a store so both the
 * header wallet menu and the trade panel's bottom buttons can open the single
 * modal instance (rendered in the header) — no duplicate modals, no prop
 * drilling.
 */
interface DepositWithdrawModalState {
  depositOpen: boolean
  withdrawOpen: boolean
  setDepositOpen: (open: boolean) => void
  setWithdrawOpen: (open: boolean) => void
}

export const useDepositWithdrawModal = create<DepositWithdrawModalState>(
  (set) => ({
    depositOpen: false,
    withdrawOpen: false,
    setDepositOpen: (open) => set({ depositOpen: open }),
    setWithdrawOpen: (open) => set({ withdrawOpen: open }),
  })
)
