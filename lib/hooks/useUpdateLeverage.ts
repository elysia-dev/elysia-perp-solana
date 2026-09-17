"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { UpdateLeverageRequest, UpdateLeverageResponse } from "@/types"
import { leverageToIMF } from "@/types"

interface UpdateLeverageParams {
  market: string
  leverage: number
}

export function useUpdateLeverage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ market, leverage }: UpdateLeverageParams) =>
      apiClient<UpdateLeverageResponse>("/perp/leverage", {
        method: "PUT",
        body: {
          market,
          initial_margin_fraction: leverageToIMF(leverage),
          margin_mode: 1,
        } satisfies UpdateLeverageRequest,
        auth: true,
      }),
    onSuccess: (_, variables) => {
      // Invalidate positions to reflect new leverage settings
      queryClient.invalidateQueries({ queryKey: ["account"] })
      queryClient.invalidateQueries({
        queryKey: ["leverage", variables.market],
      })
      queryClient.invalidateQueries({ queryKey: ["account"] })
    },
  })
}
