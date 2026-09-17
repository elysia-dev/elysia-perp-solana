import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { fetchOpenOrders } from "@/lib/hooks/useOpenPerpOrders"
import { trackTrade } from "@/lib/analytics/ga"
import type { PlacePerpOrderRequest, PlacePerpOrderResponse } from "@/types"

export function useCreatePerpOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: PlacePerpOrderRequest) =>
      apiClient<PlacePerpOrderResponse>("/perp/order", {
        method: "POST",
        body: data,
        // Without auth:true the cookie isn't sent (and 401 auto-refresh is
        // skipped), so an expired access_token silently turns a real order
        // into "Failed" instead of recovering via /auth/refresh.
        auth: true,
      }),
    onSuccess: (_, variables) => {
      trackTrade({
        market: variables.market,
        side: variables.side,
        size: variables.size,
        price: variables.price,
        orderType: variables.order_type,
        reduceOnly: variables.reduce_only,
      })
      queryClient.invalidateQueries({
        queryKey: ["orderbook", variables.market],
      })
      queryClient.invalidateQueries({
        queryKey: ["account"],
      })
      // Open orders live in a Zustand store, NOT react-query — invalidating
      // ["perpOrders","open"] was a no-op, which left a freshly placed limit
      // order invisible until the WS path caught up (300ms resubscribe or the
      // 1s-throttled refetch) — a visible 1–2s lag after the toast. Fetch the
      // store directly: once at accept, once shortly after in case the order
      // hadn't reached the open-orders view yet (placement settles async).
      fetchOpenOrders()
      setTimeout(fetchOpenOrders, 600)
      queryClient.invalidateQueries({
        queryKey: ["perpOrders", "history"],
      })
      queryClient.invalidateQueries({
        queryKey: ["trades"],
      })
    },
  })
}
