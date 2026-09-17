"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { Orderbook } from "@/types"

/**
 * REST-only orderbook hook (WebSocket 사용하지 않음)
 * Data Check 비교용
 */
export function useOrderbookRest(marketId: number) {
  const query = useQuery({
    queryKey: ["orderbook-rest", marketId],
    queryFn: () => apiClient<Orderbook>(`/orderbook/${marketId}`),
    refetchInterval: 2000,
    enabled: marketId > 0,
  })

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
  }
}
