"use client"

import { useMemo } from "react"
import type { UserBalance } from "@/types"
import { useAccount } from "./useAccount"
import { MEME_ASSET_ID } from "@/lib/solana/meme"

/**
 * Derives balance data from the /account endpoint.
 * The old /account/balances route has been removed; balance info
 * is now part of the unified /account response.
 */
export function useBalance() {
  const { data: accountData, ...rest } = useAccount()
  // WS invalidation of ["account"] is handled by usePositions
  // Both hooks share the same query, so no need to duplicate here

  const data = useMemo<UserBalance | undefined>(() => {
    const account = accountData?.accounts?.[0]
    if (!account) return undefined

    // Solana build: MEME is the only collateral in use, so drop every other
    // token /account returns — the whole app then only ever sees MEME.
    return {
      address: account.l1_address,
      balances: (account.balances ?? [])
        .filter((b) => b.asset_id === MEME_ASSET_ID)
        .map((b) => ({
          asset_id: b.asset_id,
          route_type: "perp" as const,
          available: b.available,
          locked: b.locked,
        })),
    }
  }, [accountData])

  return { data, ...rest }
}
