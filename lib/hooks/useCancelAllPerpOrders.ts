"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type {
  CancelAllPerpOrdersRequest,
  CancelAllPerpOrdersResponse,
} from "@/types"
import { useOpenOrdersStore } from "@/lib/stores/useOpenOrdersStore"
import { supersedeOpenOrdersFetch } from "@/lib/hooks/useOpenPerpOrders"

export function useCancelAllPerpOrders() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request?: CancelAllPerpOrdersRequest) =>
      apiClient<CancelAllPerpOrdersResponse>("/perp/orders", {
        method: "DELETE",
        body: request ?? {},
        auth: true,
      }),
    onSuccess: (_data, request) => {
      // Open orders live in a Zustand store (WS-fed), not react-query — clear
      // the cancelled orders from it directly so the list updates immediately.
      // Scoped to the market when one was passed, else all. Discard any
      // in-flight snapshot first — one requested before this cancel would land
      // afterwards and re-add the orders.
      supersedeOpenOrdersFetch()
      const { orders, setOrders } = useOpenOrdersStore.getState()
      setOrders(
        request?.market ? orders.filter((o) => o.market !== request.market) : []
      )
      queryClient.invalidateQueries({ queryKey: ["perpOrders", "history"] })
      queryClient.invalidateQueries({ queryKey: ["account"] })
    },
  })
}
