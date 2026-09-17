"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"

interface AdjustMarginRequest {
  market: string
  amount: string
  direction: 0 | 1 // 0 = remove, 1 = add
}

interface AdjustMarginResponse {
  id: number
  market: string
  side: string
  size: string
  entry_price: string
  mark_price: string
  margin: string
  initial_margin_fraction: number
  unrealized_pnl: string
  roe: string
  liquidation_price: string
  created_at: string
}

export function useAdjustMargin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: AdjustMarginRequest) =>
      apiClient<AdjustMarginResponse>("/perp/margin", {
        method: "POST",
        body: data,
        auth: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account"] })
    },
  })
}
