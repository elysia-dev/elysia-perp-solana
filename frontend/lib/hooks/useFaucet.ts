"use client"

// MEME faucet (server PR #973): GET /faucet reports amount + cooldown, POST
// /faucet/claim dispenses a fixed drip (1,000 MEME) to the connected account.
// Both are authenticated — the 24h cooldown is keyed by USER ACCOUNT, not
// wallet — so status only runs once logged in. Amounts come back as base-unit
// strings; divide by the token decimals for display.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { ACCOUNT_QUERY_KEY } from "@/lib/api/accountQuery"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { MEME_DECIMALS } from "@/lib/solana/meme"

export interface FaucetStatus {
  /** Drip size in base units (string to dodge JSON number range). */
  amount: string
  cooldown_seconds: number
  /** True when a claim right now would be accepted. */
  available: boolean
  /** Seconds until the next claim; absent/null when available. */
  retry_after_seconds?: number | null
}

export interface FaucetClaimResult {
  /** Solana transfer tx signature. */
  signature: string
  /** Amount sent, in base units. */
  amount: string
}

export const FAUCET_QUERY_KEY = ["faucet"] as const

/** base-unit string → UI MEME amount. */
export function faucetUiAmount(baseUnits: string | undefined): number {
  const n = Number(baseUnits)
  return Number.isFinite(n) ? n / 10 ** MEME_DECIMALS : 0
}

/** Faucet status (amount + cooldown). Only runs while authenticated; the
 *  faucet is per-account. `retry:false` so a 404 (faucet disabled on this
 *  deployment) isn't retried. */
export function useFaucetStatus() {
  const { isAuthenticated } = useAuthContext()
  return useQuery<FaucetStatus>({
    queryKey: FAUCET_QUERY_KEY,
    enabled: isAuthenticated,
    queryFn: () => apiClient<FaucetStatus>("/faucet", { auth: true }),
    refetchInterval: 30_000,
    retry: false,
  })
}

/** Claim the faucet drip. Refreshes the account balance and the faucet
 *  cooldown afterward (even on a 429, the cooldown state is worth re-reading). */
export function useFaucetClaim() {
  const queryClient = useQueryClient()
  return useMutation<FaucetClaimResult, Error>({
    mutationFn: () =>
      apiClient<FaucetClaimResult>("/faucet/claim", {
        method: "POST",
        auth: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: FAUCET_QUERY_KEY })
    },
  })
}
