"use client"

import { useEffect, useRef } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import type { DepositHistoryResponse } from "@/types"

const PAGE_SIZE = 20

export function useDepositHistory() {
  const { isAuthenticated } = useAuthContext()
  const queryClient = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ["deposit-history"],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (pageParam) params.set("from_id", String(pageParam))
      return apiClient<DepositHistoryResponse>(`/account/deposits?${params}`, {
        auth: true,
      })
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => {
      const deposits = lastPage.deposits
      if (deposits.length < PAGE_SIZE) return undefined
      return deposits[deposits.length - 1].id
    },
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      const hasPending = query.state.data?.pages.some((page) =>
        page.deposits.some((d) => d.status === "pending")
      )
      return hasPending ? 5000 : false
    },
  })

  // Refresh the account balance the moment a deposit confirms.
  //
  // Balance (`Avbl`) is derived from the `["account"]` query, which has
  // `staleTime: Infinity` and no polling — it only refreshes on a WS
  // `update/account_all` frame or a manual reload. Deposit *crediting* is a
  // separate backend path that doesn't reliably emit that WS event, so the
  // newly-credited funds wouldn't appear until the user refreshed the page.
  //
  // This hook already polls `/account/deposits` every 5s while a deposit is
  // pending (see `refetchInterval`). We pigg-back on that: the instant the
  // newest page shows one more `confirmed` deposit than before, we invalidate
  // `["account"]` so the balance refetches — no new polling loop, and it fires
  // exactly when the "Confirmed" status the user sees flips. We watch only the
  // first page (newest deposits) so paginating "load more" over old confirmed
  // rows doesn't spuriously trigger a refetch.
  const prevConfirmedRef = useRef<number | null>(null)
  useEffect(() => {
    const firstPage = query.data?.pages?.[0]
    if (!firstPage) return
    const confirmed = firstPage.deposits.filter(
      (d) => d.status === "confirmed"
    ).length
    if (
      prevConfirmedRef.current !== null &&
      confirmed > prevConfirmedRef.current
    ) {
      queryClient.invalidateQueries({ queryKey: ["account"] })
    }
    prevConfirmedRef.current = confirmed
  }, [query.data, queryClient])

  return query
}
