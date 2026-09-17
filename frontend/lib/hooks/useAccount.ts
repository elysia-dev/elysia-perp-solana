"use client"

import { useQuery } from "@tanstack/react-query"
import { accountQueryOptions } from "@/lib/api/accountQuery"
import { useAuthContext } from "../providers/AuthProvider"

export function useAccount() {
  const { isAuthenticated } = useAuthContext()

  return useQuery(accountQueryOptions(isAuthenticated))
}

/**
 * The first account's `index`, read straight from the `["account"]` query
 * cache. Replaces the old `useAccountStore` mirror: the index already lives in
 * the query, so a separate Zustand copy (fed by a `useEffect` in
 * `useAccountSync`) only added an extra hop and an ordering dependency
 * (consumers had to wait for the sync effect to run). Multiple observers of
 * the same query key are deduped by TanStack, so this is cheap.
 */
export function useAccountIndex(): number | null {
  const { data } = useAccount()
  return data?.accounts?.[0]?.index ?? null
}
