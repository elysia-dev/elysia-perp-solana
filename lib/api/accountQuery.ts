import type { UseQueryOptions } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { AccountResponse } from "@/types"

/**
 * Single source of truth for the `["account"]` query.
 *
 * Three observers read this key — `useAccount`, `useAccountSync`, and
 * `usePositions` (positions are derived from the same `/account` payload).
 * TanStack dedupes the *fetch* by key, but `staleTime` and the `refetchOn*`
 * flags are **per-observer**, so when the three hooks passed different values
 * (`Infinity` / `2000` / default) the effective refetch timing depended on
 * which hook happened to mount first — nondeterministic and a pain to debug.
 *
 * Centralising the options here keeps every observer identical. Freshness does
 * NOT rely on `staleTime`: the WS `account_all` handler and every mutation
 * (order / deposit / withdraw / cancel / leverage / margin) already call
 * `invalidateQueries(["account"])`, so a long `staleTime` just suppresses
 * redundant background refetches without ever serving stale data.
 */
export const ACCOUNT_QUERY_KEY = ["account"] as const

// 5 min. Real changes arrive via WS pushes + explicit mutation invalidations,
// so the background refetch window can be long.
export const ACCOUNT_STALE_TIME = 5 * 60 * 1000

export function accountQueryOptions(
  enabled: boolean
): Pick<
  UseQueryOptions<AccountResponse>,
  | "queryKey"
  | "queryFn"
  | "enabled"
  | "staleTime"
  | "refetchOnWindowFocus"
  | "refetchOnReconnect"
> {
  return {
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: () => apiClient<AccountResponse>("/account", { auth: true }),
    enabled,
    staleTime: ACCOUNT_STALE_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}
