"use client"

import { useQuery } from "@tanstack/react-query"
import { accountQueryOptions } from "@/lib/api/accountQuery"
import { useAuthContext } from "@/lib/providers/AuthProvider"

/**
 * Activates the `["account"]` query on auth so account data is fetched at the
 * top level (e.g. page.tsx) regardless of which child components mount.
 *
 * Previously this also mirrored the result into a Zustand `useAccountStore`;
 * that copy was removed — consumers now read the account directly from the
 * query (`useAccount` / `useAccountIndex`), so there's a single source of
 * truth and no sync-ordering hop.
 */
export function useAccountSync() {
  const { isAuthenticated } = useAuthContext()
  useQuery(accountQueryOptions(isAuthenticated))
}
