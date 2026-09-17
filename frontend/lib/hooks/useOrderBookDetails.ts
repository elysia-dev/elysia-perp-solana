"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { OrderBookDetailsResponse } from "@/types"

export function useOrderBookDetails() {
  return useQuery({
    queryKey: ["orderBookDetails"],
    queryFn: () => apiClient<OrderBookDetailsResponse>("/orderBookDetails"),
    staleTime: 5 * 60 * 1000, // 5 minutes (rarely changes)
  })
}
