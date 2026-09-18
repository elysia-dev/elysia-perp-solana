"use client"

// Mint MEME — UI ONLY. This modal renders the mint form (amount input + button)
// but performs NO on-chain mint: the submit is a placeholder. Wire an actual
// mint call into `onMint` when the mint flow is implemented.

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { NETWORK_LABEL } from "@/lib/solana/network"

export function MintModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [amount, setAmount] = useState("")

  // Placeholder — no real mint yet. Kept as a no-op with a visible note so the
  // form reads as "not wired" rather than broken.
  const onMint = () => {
    // TODO: implement the MEME mint transaction here.
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Mint MEME
            <span className="rounded bg-[#0086fc]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#0086fc]">
              {NETWORK_LABEL}
            </span>
          </DialogTitle>
          <DialogDescription>
            Mint test MEME to your connected wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Amount */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Amount</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:border-[#0086fc]">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="1000"
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none"
              />
              <span className="text-xs font-medium text-muted-foreground">
                MEME
              </span>
            </div>
          </label>

          <Button onClick={onMint} disabled={!amount} className="w-full">
            Mint
          </Button>

          <p className="text-[11px] text-muted-foreground/70">
            Minting isn&apos;t available in this build yet.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
