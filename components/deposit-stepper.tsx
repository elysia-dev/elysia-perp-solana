"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

export type StepStatus = "pending" | "active" | "done"

// Default confirmation count — the server's global `block_confirmations`.
// Chains with a different policy (Giwa Sepolia = 30) pass an explicit
// `requiredConfirmations` prop; see `getDepositConfirmations()` in
// `lib/contracts/addresses.ts`, which must mirror the server config.
const DEFAULT_REQUIRED_CONFIRMATIONS = 15
// After the final confirmation the server still takes ~1-2s to write the credit.
// Hold the gauge here so it fills to 100% / flips to "Done" right when the
// balance actually changes, rather than a beat early.
const CREDIT_BUFFER_MS = 2000

function formatEta(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  if (totalSec < 60) return `~${totalSec}s`
  return `~${Math.ceil(totalSec / 60)}m`
}

function StepRow({
  index,
  title,
  status,
  detail,
}: {
  index: number
  title: string
  status: StepStatus
  detail?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
          status === "done"
            ? "border-success bg-success/10 text-success"
            : status === "active"
              ? "border-primary text-primary"
              : "border-border text-muted-foreground"
        }`}
      >
        {status === "done" ? (
          <Check className="size-3" />
        ) : status === "active" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          index
        )}
      </div>
      <div className="flex flex-1 flex-col">
        <span
          className={`text-sm ${
            status === "pending" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {title}
        </span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * In-modal progress for the deposit flow: Approve → Deposit → Crediting.
 *
 * The first two steps mirror the on-chain txs; the third reflects the server's
 * ~15-block confirmation wait before the balance is credited, shown as a live
 * `N/15 · ~ETA` countdown so the user always knows where the deposit stands.
 * Closing the modal is safe — `usePendingDepositMonitor` keeps refreshing the
 * balance in the background once the confirmations land.
 */
export function DepositStepper({
  showApprove,
  approveStatus,
  depositStatus,
  depositBlock,
  blockTimeMs,
  currentBlock,
  requiredConfirmations = DEFAULT_REQUIRED_CONFIRMATIONS,
  onClose,
}: {
  showApprove: boolean
  approveStatus: StepStatus
  depositStatus: StepStatus
  depositBlock: number | undefined
  blockTimeMs: number
  currentBlock: number | undefined
  requiredConfirmations?: number
  onClose: () => void
}) {
  // 1s ticker so the ETA counts down smoothly between blocks. Kept in state
  // (set from an effect) so render stays pure for the React compiler.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Wall-clock of when the current block was first observed, so we can subtract
  // the time already elapsed in this block from the ETA (smooth per-second
  // countdown rather than a value that jumps only when a block lands).
  const [lastBlockAt, setLastBlockAt] = useState<number | null>(null)
  const prevBlockRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (currentBlock != null && currentBlock !== prevBlockRef.current) {
      prevBlockRef.current = currentBlock
      setLastBlockAt(Date.now())
    }
  }, [currentBlock])

  const minedReady = depositStatus === "done" && depositBlock != null
  const confirmations =
    minedReady && currentBlock != null
      ? Math.max(
          0,
          Math.min(requiredConfirmations, currentBlock - depositBlock)
        )
      : 0
  const atMax = minedReady && confirmations >= requiredConfirmations

  // Mark when the final confirmation landed, to time the post-confirmation
  // credit buffer from.
  const [reachedMaxAt, setReachedMaxAt] = useState<number | null>(null)
  useEffect(() => {
    if (atMax && reachedMaxAt == null) setReachedMaxAt(Date.now())
  }, [atMax, reachedMaxAt])

  const msSinceBlock =
    now != null && lastBlockAt != null ? Math.max(0, now - lastBlockAt) : 0
  const bufferElapsed =
    reachedMaxAt != null && now != null ? now - reachedMaxAt : 0

  const creditDone = atMax && bufferElapsed >= CREDIT_BUFFER_MS
  const creditActive = minedReady && !creditDone
  const creditStatus: StepStatus = creditDone
    ? "done"
    : creditActive
      ? "active"
      : "pending"

  // Time-based gauge so it rises continuously (~1s/s) instead of jumping a
  // chunk per block. Pre-max: confirmed blocks + the time already spent in the
  // current block (capped at one block so a slow block can't overshoot the next
  // position). At/after max: ride the credit buffer the rest of the way to 100%.
  const totalMs = requiredConfirmations * blockTimeMs + CREDIT_BUFFER_MS
  const elapsedMs = atMax
    ? requiredConfirmations * blockTimeMs +
      Math.min(CREDIT_BUFFER_MS, bufferElapsed)
    : confirmations * blockTimeMs + Math.min(blockTimeMs, msSinceBlock)
  const pct = Math.min(100, (elapsedMs / totalMs) * 100)
  const etaMs = Math.max(0, totalMs - elapsedMs)

  const creditDetail = creditDone
    ? "Balance credited"
    : creditActive
      ? etaMs > 0
        ? `${formatEta(etaMs)} remaining`
        : "Almost there…"
      : "Waiting for deposit to confirm"

  // Step numbering shifts when the token is already approved (no approve step).
  const depositIndex = showApprove ? 2 : 1
  const creditIndex = showApprove ? 3 : 2
  const allDone = creditDone

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex flex-col gap-4">
        {showApprove ? (
          <StepRow
            index={1}
            title="Approve token"
            status={approveStatus}
            detail={
              approveStatus === "active"
                ? "Confirm in your wallet…"
                : approveStatus === "done"
                  ? "Approved"
                  : undefined
            }
          />
        ) : null}

        <StepRow
          index={depositIndex}
          title="Deposit"
          status={depositStatus}
          detail={
            depositStatus === "active"
              ? "Confirm & submit…"
              : depositStatus === "done"
                ? "Submitted on-chain"
                : undefined
          }
        />

        <div className="flex flex-col gap-2">
          <StepRow
            index={creditIndex}
            title="Crediting balance"
            status={creditStatus}
            detail={creditDetail}
          />
          {creditActive ? (
            <div className="ml-8 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-success transition-[width] duration-1000 ease-linear"
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>

      {allDone ? (
        <Button className="w-full" onClick={onClose}>
          Done
        </Button>
      ) : (
        <Button variant="outline" className="w-full" onClick={onClose}>
          Close (keeps crediting in background)
        </Button>
      )}
    </div>
  )
}
