"use client"

// MEME withdrawal modal. Withdrawal is NOT a client-side transaction: the
// client asks the server (POST /account/withdraw) and the server (which holds
// the withdrawer key) pays out. For Solana assets a `destination` is required
// and must be a wallet LINKED to this account — the connected wallet qualifies
// because the user logged in with it. Every withdrawal enters admin approval
// first (pending_approval → pending → submitted → confirmed); the client tracks
// status in the Withdrawals tab.

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useAppKitAccount } from "@reown/appkit/react"
import { useBalance } from "@/lib/hooks/useBalance"
import { useWithdraw } from "@/lib/hooks/useWithdraw"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { MEME_ASSET_ID } from "@/lib/solana/meme"
import { NETWORK_LABEL } from "@/lib/solana/network"

export function SolanaWithdrawModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { address } = useAppKitAccount({ namespace: "solana" })
  const { isAuthenticated } = useAuthContext()
  const { data: ledger } = useBalance()
  const withdraw = useWithdraw()

  const [amount, setAmount] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = Number(
    ledger?.balances.find((b) => b.asset_id === MEME_ASSET_ID)?.available ?? 0
  )

  useEffect(() => {
    if (!open) {
      setAmount("")
      setDone(false)
      setError(null)
    }
  }, [open])

  const overMax = Number(amount) > available
  const onWithdraw = async () => {
    if (!address) return
    setError(null)
    try {
      await withdraw.mutateAsync({
        asset_id: MEME_ASSET_ID,
        amount,
        destination: address, // connected (linked) Solana wallet
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Withdraw MEME
            <span className="rounded bg-[#0086fc]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0086fc]">
              {NETWORK_LABEL}
            </span>
          </DialogTitle>
          <DialogDescription>
            Withdraw MEME$ collateral back to your connected wallet. The server
            processes the payout.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                Withdrawal requested
              </span>
              <span className="text-xs text-muted-foreground">
                It enters admin approval first (pending_approval → confirmed).
                Track its status and transaction in the Withdrawals tab.
              </span>
            </div>
            <Button className="mt-1 w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Amount */}
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Amount</span>
                <button
                  type="button"
                  onClick={() => setAmount(String(available))}
                  className="text-[11px] text-[#0086fc]"
                >
                  Available:{" "}
                  {available.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })}{" "}
                  MEME$
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:border-[#0086fc]">
                <input
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  inputMode="decimal"
                  placeholder="10"
                  className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none"
                />
                <span className="text-xs font-medium text-muted-foreground">
                  MEME$
                </span>
              </div>
            </label>

            {/* Destination: the connected (linked) wallet */}
            {address && (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">To wallet</span>
                <span className="font-mono text-xs text-foreground">
                  {address.slice(0, 6)}…{address.slice(-6)}
                </span>
              </div>
            )}

            <Button
              onClick={onWithdraw}
              disabled={
                !isAuthenticated ||
                withdraw.isPending ||
                !amount ||
                Number(amount) <= 0 ||
                overMax
              }
              className="w-full"
            >
              {withdraw.isPending
                ? "Requesting…"
                : !isAuthenticated
                  ? "Sign in first"
                  : overMax
                    ? "Not enough MEME$"
                    : "Withdraw"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive-foreground">
                {error}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
