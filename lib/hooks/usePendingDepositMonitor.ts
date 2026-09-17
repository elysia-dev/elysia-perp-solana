"use client"

import { useEffect, useRef } from "react"
import { useBlockNumber } from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { usePendingDepositStore } from "@/lib/stores/usePendingDepositStore"
import { getDepositConfirmations } from "@/lib/contracts/addresses"

const MAX_AGE_MS = 5 * 60_000 // 5 minutes safety fallback

// After the 15th confirmation the server is eligible to credit the deposit, but
// the deposit's status flip and the actual balance write are separate backend
// steps — a single refetch at exactly block+15 often reads the pre-credit
// balance and then never retries, which is why credited funds can show up
// "late". So once confirmed we re-fetch `["account"]` a few times over this
// grace window to ride out the credit lag before dropping the pending entry.
const GRACE_POLL_INTERVAL_MS = 4000
const GRACE_POLL_MAX = 8 // ~32s of retries after block+15

/**
 * Monitors pending deposits and refreshes the account balance once they reach
 * enough block confirmations. Call this once in a top-level, always-mounted
 * component (the Header) so the refresh fires regardless of which view is open
 * — the deposit-history poll only runs while the history panel is mounted, so
 * without this a deposit that confirms while the user is elsewhere wouldn't
 * surface until a WS account snapshot or a manual reload.
 */
export function usePendingDepositMonitor() {
  const deposits = usePendingDepositStore((s) => s.deposits)
  const removeDeposit = usePendingDepositStore((s) => s.removeDeposit)
  const queryClient = useQueryClient()

  const { data: currentBlock } = useBlockNumber({
    watch: deposits.length > 0,
  })

  // txHashes whose post-confirmation grace poll has already started, so block
  // ticks don't spawn duplicate pollers. Cleared when the deposit is removed.
  const settlingRef = useRef<Set<string>>(new Set())
  // Flipped on unmount so an in-flight grace poll stops touching the cache.
  const cancelledRef = useRef(false)
  useEffect(() => {
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!currentBlock || deposits.length === 0) return

    const now = Date.now()

    for (const deposit of deposits) {
      // Already settling — its grace poll owns the rest of its lifecycle.
      if (settlingRef.current.has(deposit.txHash)) continue

      // Per-chain policy (Giwa 30, default 15) — must mirror the server's
      // `block_confirmations`. Entries persisted before `chainId` existed
      // fall back to the default inside the helper.
      const blockConfirmed =
        Number(currentBlock) >=
        deposit.depositBlock + getDepositConfirmations(deposit.chainId)
      const timeExpired = now - deposit.timestamp >= MAX_AGE_MS

      // Safety fallback: a deposit we somehow never saw confirm (missed blocks,
      // wallet switched to a chain we're not watching) is dropped after MAX_AGE
      // with one last refresh so it can't linger forever.
      if (timeExpired && !blockConfirmed) {
        removeDeposit(deposit.txHash)
        queryClient.invalidateQueries({ queryKey: ["account"] })
        queryClient.invalidateQueries({ queryKey: ["deposit-history"] })
        continue
      }

      if (!blockConfirmed) continue

      // 15 confirmations reached → start the bounded grace poll once.
      settlingRef.current.add(deposit.txHash)
      const txHash = deposit.txHash
      let tries = 0
      const poll = () => {
        if (cancelledRef.current) return
        queryClient.invalidateQueries({ queryKey: ["account"] })
        queryClient.invalidateQueries({ queryKey: ["deposit-history"] })
        tries += 1
        if (tries >= GRACE_POLL_MAX) {
          removeDeposit(txHash)
          settlingRef.current.delete(txHash)
          return
        }
        setTimeout(poll, GRACE_POLL_INTERVAL_MS)
      }
      poll()
    }
  }, [currentBlock, deposits, removeDeposit, queryClient])
}
