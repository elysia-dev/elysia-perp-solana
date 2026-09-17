"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { MarkPriceResponse } from "@/types"

// REST fallback — only used for initial load before WS connects
export function useMarkPrice(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ["markPrice", symbol],
    queryFn: () =>
      apiClient<MarkPriceResponse>(`/markets/${symbol}/mark-price`),
    enabled: enabled && !!symbol,
    staleTime: 30000, // 30s — WS handles real-time updates
    refetchOnWindowFocus: false,
  })
}

export function useMarkPrices(symbols: string[]) {
  const symbolsKey = [...symbols].sort().join(",")

  return useQuery({
    queryKey: ["markPrices", symbolsKey],
    queryFn: async () => {
      const results = await Promise.all(
        symbols.map((symbol) =>
          apiClient<MarkPriceResponse>(`/markets/${symbol}/mark-price`).catch(
            () => null
          )
        )
      )
      const priceMap = new Map<string, MarkPriceResponse>()
      results.forEach((result, index) => {
        if (result) {
          priceMap.set(symbols[index], result)
        }
      })
      return priceMap
    },
    enabled: symbols.length > 0,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  })
}
