"use client"

import { useEffect, useRef } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import type { WithdrawalHistoryResponse, WithdrawalStatus } from "@/types"

const PAGE_SIZE = 20

// Statuses where the withdrawal is still in flight and its funds remain locked
// out of the tradable balance.
const PENDING_STATUSES: WithdrawalStatus[] = [
  "pending",
  "pending_approval",
  "submitted",
]
const isPending = (s: WithdrawalStatus) => PENDING_STATUSES.includes(s)

export function useWithdrawalHistory() {
  const { isAuthenticated } = useAuthContext()
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ["withdrawal-history"],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set("from_id", String(pageParam))
      return apiClient<WithdrawalHistoryResponse>(
        `/account/withdrawals?${params}`,
        { auth: true }
      )
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      const withdrawals = lastPage.withdrawals
      if (withdrawals.length < PAGE_SIZE) return undefined
      return withdrawals[withdrawals.length - 1].id
    },
    enabled: isAuthenticated,
    // Poll every 5s while there are pending/submitted withdrawals
    refetchInterval: (query) => {
      const hasPending = query.state.data?.pages.some((page) =>
        page.withdrawals.some((w) => isPending(w.status))
      )
      return hasPending ? 5000 : false
    },
  })

  // When a withdrawal leaves the pending set (denied → funds refunded, or
  // confirmed → funds finalized), the account balance changed server-side but
  // nothing else refetches it — so the tradable balance (Avbl) stayed stale
  // until a manual reload. Watch the per-id status and invalidate ["account"]
  // on any pending→terminal transition.
  const prevStatusRef = useRef<Map<number, WithdrawalStatus>>(new Map())
  const withdrawals = query.data?.pages.flatMap((p) => p.withdrawals)
  useEffect(() => {
    if (!withdrawals) return
    const prev = prevStatusRef.current
    let settled = false
    const next = new Map<number, WithdrawalStatus>()
    for (const w of withdrawals) {
      next.set(w.id, w.status)
      const was = prev.get(w.id)
      // A tracked withdrawal that was pending and is now terminal.
      if (was !== undefined && isPending(was) && !isPending(w.status)) {
        settled = true
      }
    }
    prevStatusRef.current = next
    if (settled) {
      queryClient.invalidateQueries({ queryKey: ["account"] })
    }
  }, [withdrawals, queryClient])

  return query
}
