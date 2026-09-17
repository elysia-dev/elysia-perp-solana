"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { CancelPerpOrderRequest, CancelPerpOrderResponse } from "@/types"
import { useOpenOrdersStore } from "@/lib/stores/useOpenOrdersStore"
import { supersedeOpenOrdersFetch } from "@/lib/hooks/useOpenPerpOrders"

export function useCancelPerpOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CancelPerpOrderRequest) =>
      apiClient<CancelPerpOrderResponse>("/perp/order", {
        method: "DELETE",
        body: request,
        auth: true,
      }),
    onSuccess: (_data, request) => {
      // Open orders live in a Zustand store fed by WS (account_all_orders), NOT
      // react-query — so drop the cancelled order from the store directly to
      // remove it from the list immediately. Relying on the WS cancel event
      // leaves it lingering when the socket lags or (broken ws-token) never
      // connects. (A react-query invalidate of ["perpOrders","open"] is a no-op
      // here: nothing observes that key.)
      // Discard any in-flight open-orders snapshot first — one requested
      // before this cancel would land afterwards and re-add the order.
      supersedeOpenOrdersFetch()
      useOpenOrdersStore.getState().removeOrder(request.order_id)
      queryClient.invalidateQueries({ queryKey: ["perpOrders", "history"] })
      queryClient.invalidateQueries({ queryKey: ["account"] })
    },
  })
}
