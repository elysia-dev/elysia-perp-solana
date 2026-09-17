"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { useClosingPositions } from "@/lib/stores/useClosingPositions"
import type { ClosePositionRequest, ClosePositionResponse } from "@/types"

// The close POST resolves on order ACCEPT; the fill settles asynchronously,
// so the immediate invalidate below often refetches a still-open position.
// Chase the settle with a couple of delayed refetches so the row disappears
// without waiting for the next WS event + 1s throttle window.
const SETTLE_REFETCH_DELAYS_MS = [600, 1800]
// How long the "Closing…" badge may live after a successful close order —
// long enough to cover the settle window, short enough that a PARTIAL close
// (row legitimately stays, smaller) doesn't wear a stale badge.
const CLOSING_BADGE_TTL_MS = 4000

export function useClosePosition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ClosePositionRequest) =>
      apiClient<ClosePositionResponse>("/perp/order", {
        method: "POST",
        body: request,
        auth: true,
      }),
    onMutate: (request) => {
      useClosingPositions.getState().markClosing(request.market)
    },
    onError: (_err, request) => {
      useClosingPositions.getState().clearClosing(request.market)
    },
    onSuccess: (_data, request) => {
      queryClient.invalidateQueries({ queryKey: ["account"] })
      queryClient.invalidateQueries({ queryKey: ["perpOrders", "open"] })
      queryClient.invalidateQueries({ queryKey: ["perpOrders", "history"] })
      for (const delay of SETTLE_REFETCH_DELAYS_MS) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["account"] })
        }, delay)
      }
      setTimeout(() => {
        useClosingPositions.getState().clearClosing(request.market)
      }, CLOSING_BADGE_TTL_MS)
    },
  })
}
