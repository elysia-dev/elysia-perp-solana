"use client"

import { useQuery } from "@tanstack/react-query"

export interface ElPrice {
  /** EL market price in USD. */
  usd: number
  /** 24h price change, percent (e.g. 2.14 = +2.14%). */
  usd_24h_change: number
}

/**
 * EL market price + 24h change, via the cached `/api/el-price` proxy
 * (CoinGecko `simple/price`). Polls every 60s to match the server cache TTL —
 * more frequent polling wouldn't return fresher data.
 */
export function useElPrice() {
  return useQuery<ElPrice>({
    queryKey: ["el-price"],
    queryFn: async () => {
      const res = await fetch("/api/el-price")
      if (!res.ok) throw new Error("el-price fetch failed")
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 60_000,
  })
}
