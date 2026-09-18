"use client"

// MEME faucet modal (server PR #973). Claims a fixed drip (1,000 MEME) to the
// connected, authenticated account — no amount input. The faucet is per-account
// with a 24h cooldown, so it needs a logged-in session, and it 404s on any
// deployment where the faucet isn't enabled.

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CheckCircle2 } from "lucide-react"
import { NETWORK_LABEL, getExplorerTxUrl } from "@/lib/solana/network"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import {
  useFaucetStatus,
  useFaucetClaim,
  faucetUiAmount,
} from "@/lib/hooks/useFaucet"
import { useSolNativeBalance } from "@/lib/solana/useSolBalance"
import { ApiError } from "@/lib/api/client"

function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

export function MintModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { isAuthenticated } = useAuthContext()
  const { data: status, error: statusError } = useFaucetStatus()
  const { data: solBalance } = useSolNativeBalance()
  const claim = useFaucetClaim()

  // A claim creates the recipient MEME token account (rent) and needs the wallet
  // to hold some native SOL — with zero SOL the on-chain claim can't settle, so
  // block it up front. Only gate once the balance is actually known.
  const noSol = isAuthenticated && solBalance != null && solBalance <= 0

  const amountLabel = status
    ? faucetUiAmount(status.amount).toLocaleString("en-US")
    : "1,000"
  const faucetUnavailable =
    statusError instanceof ApiError && statusError.status === 404
  const onCooldown = !!status && !status.available
  const cooldownLeft = status?.retry_after_seconds ?? 0
  const claimErr = claim.error instanceof ApiError ? claim.error : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Get MEME
            <span className="rounded bg-[#0086fc]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0086fc]">
              {NETWORK_LABEL}
            </span>
          </DialogTitle>
          <DialogDescription>
            Claim {amountLabel} MEME from the faucet to your account. One claim
            every 24 hours.
          </DialogDescription>
        </DialogHeader>

        {claim.isSuccess ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <span className="text-sm font-medium text-foreground">
              {faucetUiAmount(claim.data.amount).toLocaleString("en-US")} MEME
              sent
            </span>
            <a
              href={getExplorerTxUrl(claim.data.signature)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-[#0086fc] underline"
            >
              View transaction ↗
            </a>
            <Button
              variant="outline"
              className="mt-1 w-full"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Fixed drip — no amount input. */}
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-3">
              <span className="text-xs text-muted-foreground">You receive</span>
              <span className="font-mono text-sm text-foreground">
                {amountLabel} MEME
              </span>
            </div>

            <Button
              onClick={() => claim.mutate()}
              disabled={
                !isAuthenticated ||
                faucetUnavailable ||
                onCooldown ||
                noSol ||
                claim.isPending
              }
              className="w-full"
            >
              {claim.isPending
                ? "Claiming…"
                : !isAuthenticated
                  ? "Sign in to claim"
                  : faucetUnavailable
                    ? "Faucet unavailable"
                    : onCooldown
                      ? `Available in ${formatCooldown(cooldownLeft)}`
                      : noSol
                        ? "Need SOL for fees"
                        : `Claim ${amountLabel} MEME`}
            </Button>

            {!isAuthenticated && (
              <p className="text-[11px] text-muted-foreground/70">
                Connect your wallet and sign in first — the faucet is limited per
                account.
              </p>
            )}

            {faucetUnavailable && (
              <p className="text-[11px] text-muted-foreground/70">
                The faucet isn&apos;t enabled on this network.
              </p>
            )}

            {noSol && (
              <p className="text-[11px] text-muted-foreground/70">
                Your wallet has no SOL. Fund it with a little SOL first — the
                claim needs it for the token-account rent and fees.
              </p>
            )}

            {claimErr && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive-foreground">
                {claimErr.status === 429
                  ? `On cooldown${cooldownLeft ? ` — try again in ${formatCooldown(cooldownLeft)}` : ""}.`
                  : claimErr.message || "Claim failed."}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
