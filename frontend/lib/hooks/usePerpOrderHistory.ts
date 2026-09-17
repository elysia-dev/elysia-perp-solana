"use client"

import { useEffect, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { PerpOrdersRawResponse, PerpOrdersResponse } from "@/types"
import { toPerpOrder } from "@/types"
import { useAuthContext } from "../providers/AuthProvider"
import { useWebSocket } from "../providers/WebSocketProvider"
import { useAccountIndex } from "./useAccount"

export function usePerpOrderHistory() {
  const { isAuthenticated } = useAuthContext()
  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()
  const accountIndex = useAccountIndex()

  const query = useQuery({
    queryKey: ["perpOrders", "history"],
    queryFn: async (): Promise<PerpOrdersResponse> => {
      const raw = await apiClient<PerpOrdersRawResponse>("/perp/orders", {
        auth: true,
      })
      return { orders: raw.orders.map(toPerpOrder) }
    },
    enabled: isAuthenticated,
  })

  // Refetch order history on WS account updates so filled orders (and the
  // chart's B/S execution markers derived from them) appear live instead of
  // only after a manual reload. Trailing-edge throttle, same as usePositions /
  // useOpenPerpOrders: fill events burst and the LAST one — the completed
  // fill — is the one that matters, so a leading-only throttle would drop it.
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (accountIndex == null) return

    const invalidate = () => {
      if (throttleRef.current) {
        pendingRef.current = true
        return
      }
      queryClient.invalidateQueries({ queryKey: ["perpOrders", "history"] })
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null
        if (pendingRef.current) {
          pendingRef.current = false
          invalidate()
        }
      }, 1000)
    }

    const unsubscribe = subscribe(
      `account_all/${accountIndex}`,
      (raw: unknown) => {
        const msg = raw as { type?: string }
        if (
          typeof msg.type === "string" &&
          (msg.type.startsWith("update/") ||
            msg.type === "subscribed/account_all")
        ) {
          invalidate()
        }
      }
    )

    return () => {
      unsubscribe()
      if (throttleRef.current) clearTimeout(throttleRef.current)
      throttleRef.current = null
      pendingRef.current = false
    }
  }, [accountIndex, subscribe, queryClient])

  return query
}
