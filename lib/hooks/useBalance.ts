"use client"

import { useMemo } from "react"
import type { UserBalance } from "@/types"
import { useAccount } from "./useAccount"

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

    // Multi-token (ELP-133): the account now carries one balance entry per
    // registered deposit token. Map each into the perp-route Balance shape.
    return {
      address: account.l1_address,
      balances: (account.balances ?? []).map((b) => ({
        asset_id: b.asset_id,
        route_type: "perp" as const,
        available: b.available,
        locked: b.locked,
      })),
    }
  }, [accountData])

  return { data, ...rest }
}
