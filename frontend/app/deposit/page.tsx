"use client"

// Solana devnet deposit test page. Fully on-chain (Elysia vault program
// 6Q6A6yRt… on devnet) — needs no Elysia backend. See
// lib/solana/useSolDeposit.ts. `credit_to` is a manual dev input here because
// the server session (which would supply it) isn't wired for Solana yet; in
// production it MUST come from the authenticated session, never a text field.

import { useState } from "react"
import { PageShell } from "@/components/layout/PageShell"
import { Button } from "@/components/ui/button"
import { useAppKit } from "@reown/appkit/react"
import { useSolDeposit } from "@/lib/solana/useSolDeposit"
import { getExplorerTxUrl } from "@/lib/solana/network"

function shortSig(sig: string) {
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`
}

export default function DepositPage() {
  const { open } = useAppKit()
  const { deposit, address, isConnected } = useSolDeposit()
  const [amount, setAmount] = useState("0.25")
  const [pending, setPending] = useState(false)
  const [txSig, setTxSig] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onDeposit = async () => {
    setError(null)
    setTxSig(null)
    setPending(true)
    try {
      const sig = await deposit(Number(amount)) // credits the connected wallet
      setTxSig(sig)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed")
    } finally {
      setPending(false)
    }
  }

  const usd = Number(amount) > 0 ? Number(amount) : 0

  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-5 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-medium text-foreground">
            Deposit SPYDER{" "}
            <span className="text-sm text-[#0086fc]">devnet</span>
          </h1>
          <p className="text-xs leading-[18px] text-muted-foreground">
            On-chain SPL deposit into the Elysia vault program on Solana devnet.
            No backend required — the connected wallet signs the transaction.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-5">
          {/* Wallet */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Wallet</span>
            {isConnected && address ? (
              <span className="font-mono text-xs text-foreground">
                {address.slice(0, 4)}…{address.slice(-4)}
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={() => open()}>
                Connect Wallet
              </Button>
            )}
          </div>

          {/* Amount */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              Amount (SPYDER)
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="10"
              className="rounded-md border border-border bg-[#0a0a0a] px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-[#0086fc]"
            />
            <span className="text-[11px] text-muted-foreground/70">
              ≈ ${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}{" "}
              credited to your connected wallet (SPYDER is a $1 peg)
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

          {txSig && (
            <div className="flex flex-col gap-1 rounded-md border border-success/40 bg-success/10 px-3 py-2.5">
              <span className="text-xs font-medium text-success">
                Deposit sent
              </span>
              <a
                href={getExplorerTxUrl(txSig)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-[#0086fc] underline"
              >
                {shortSig(txSig)} ↗
              </a>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive-foreground">
              {error}
            </div>
          )}
        </section>

        <p className="text-[11px] leading-[16px] text-muted-foreground/70">
          Need SPYDER? It&apos;s a devnet SPL token minted by the team — ask for
          some sent to your wallet. You also need a little devnet SOL for fees:{" "}
          <code className="font-mono text-muted-foreground">
            solana airdrop 1 &lt;wallet&gt; --url devnet
          </code>
          .
        </p>
      </div>
    </PageShell>
  )
}
