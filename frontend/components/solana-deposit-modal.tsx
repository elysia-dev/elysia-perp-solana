"use client"

// MEME deposit modal — in-app entry point wired to the header "Deposit"
// button. On-chain SPL deposit against the devnet vault program (market 129's
// MEME quote token). MEME is a $1 peg (1:1).
//
// The transfer is instant on-chain, but the ledger credit (MEME$) lands only
// once the server's deposit watcher picks the transaction up — a few seconds.
// So after a successful deposit the modal shows a "crediting" state and polls
// /account until the MEME$ balance rises, then confirms.

import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useSolDeposit } from "@/lib/solana/useSolDeposit"
import { useSolBalance } from "@/lib/solana/useSolBalance"
import { useBalance } from "@/lib/hooks/useBalance"
import { ACCOUNT_QUERY_KEY } from "@/lib/api/accountQuery"
import { MEME_ASSET_ID } from "@/lib/solana/meme"
import { getExplorerTxUrl } from "@/lib/solana/network"

type Phase = "form" | "crediting" | "credited"

export function SolanaDepositModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { deposit, isConnected } = useSolDeposit()
  const { data: walletBalance } = useSolBalance() // wallet MEME token
  const { data: ledger } = useBalance() // /account balances (MEME$)
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState("")
  const [phase, setPhase] = useState<Phase>("form")
  const [pending, setPending] = useState(false) // wallet signature in progress
  const [txSig, setTxSig] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const baselineRef = useRef(0)

  // Ledger MEME$ balance (dollar collateral) from /account.
  const ledgerSpyder = Number(
    ledger?.balances.find((b) => b.asset_id === MEME_ASSET_ID)?.available ?? 0
  )
  const credited = Math.max(0, ledgerSpyder - baselineRef.current)

  // Reset to the form whenever the modal closes.
  useEffect(() => {
    if (!open) {
      setPhase("form")
      setTxSig(null)
      setError(null)
      setAmount("")
      setSlow(false)
    }
  }, [open])

  // While crediting, poll /account until the watcher credits the deposit.
  useEffect(() => {
    if (phase !== "crediting") return
    const started = Date.now()
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      if (Date.now() - started > 90_000) setSlow(true)
    }, 3000)
    return () => clearInterval(timer)
  }, [phase, queryClient])

  // Detect the credit landing: ledger rose above the pre-deposit baseline.
  useEffect(() => {
    if (phase === "crediting" && ledgerSpyder > baselineRef.current + 1e-9) {
      setPhase("credited")
    }
  }, [phase, ledgerSpyder])

  const onDeposit = async () => {
    setError(null)
    setTxSig(null)
    setPending(true)
    try {
      baselineRef.current = ledgerSpyder
      const sig = await deposit(Number(amount))
      setTxSig(sig)
      setPhase("crediting")
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed")
    } finally {
      setPending(false)
    }
  }

  const usd = Number(amount) > 0 ? Number(amount) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Deposit MEME
            <span className="rounded bg-[#0086fc]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0086fc]">
              devnet
            </span>
          </DialogTitle>
          <DialogDescription>
            Deposit MEME into the Elysia vault on Solana devnet. Your wallet
            signs the transaction.
          </DialogDescription>
        </DialogHeader>

        {phase === "form" && (
          <div className="flex flex-col gap-4">
            {/* Amount */}
            <label className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Amount</span>
                <span className="text-[11px] text-muted-foreground/70">
                  Balance:{" "}
                  {walletBalance != null ? walletBalance.toFixed(2) : "-"} MEME
                </span>
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
                  MEME
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/70">
                ≈ $
                {usd.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                credited (MEME is a $1 peg)
              </span>
            </label>

            <Button
              onClick={onDeposit}
              disabled={!isConnected || pending || !amount}
              className="w-full"
            >
              {pending
                ? "Confirm in wallet…"
                : !isConnected
                  ? "Connect wallet first"
                  : "Deposit"}
            </Button>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive-foreground">
                {error}
              </div>
            )}
          </div>
        )}

        {phase === "crediting" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#0086fc]" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                Deposit confirmed on-chain
              </span>
              <span className="text-xs text-muted-foreground">
                {slow
                  ? "Still crediting — this can take a bit. Your MEME$ will appear once the network credits it; you can close this."
                  : "Crediting to your balance… usually a few seconds."}
              </span>
            </div>
            {txSig && (
              <a
                href={getExplorerTxUrl(txSig)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-[#0086fc] underline"
              >
                View transaction ↗
              </a>
            )}
            <Button
              variant="outline"
              className="mt-1 w-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        )}

        {phase === "credited" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">
                Credited to your balance
              </span>
              <span className="font-mono text-lg font-medium text-success">
                +
                {credited.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}{" "}
                MEME$
              </span>
            </div>
            {txSig && (
              <a
                href={getExplorerTxUrl(txSig)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-[#0086fc] underline"
              >
                View transaction ↗
              </a>
            )}
            <Button className="mt-1 w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
