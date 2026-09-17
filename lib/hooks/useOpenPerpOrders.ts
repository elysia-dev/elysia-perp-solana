"use client"

import { useEffect, useRef } from "react"
import { apiClient } from "@/lib/api/client"
import type { PerpOrdersRawResponse, PerpOrder } from "@/types"
import { toPerpOrder } from "@/types"
import { useAuthContext } from "../providers/AuthProvider"
import { useWebSocket } from "../providers/WebSocketProvider"
import { useAccountIndex } from "./useAccount"
import { useOpenOrdersStore } from "../stores/useOpenOrdersStore"

interface WsSnapshotEntry {
  order_id: number
  market_id: number
  market: string
  side: "Long" | "Short"
  price: string
  initial_base_amount: string
  filled_base_amount: string
  remaining_base_amount: string
  initial_margin_fraction: number
  reduce_only: boolean
  status: string
  timestamp?: number
}

function snapshotEntryToOrder(entry: WsSnapshotEntry): PerpOrder {
  return {
    id: entry.order_id,
    market: entry.market ?? "",
    side: entry.side ?? "Long",
    order_type: "Limit",
    price: entry.price ?? "0",
    initial_base_amount: entry.initial_base_amount ?? "0",
    filled_base_amount: entry.filled_base_amount ?? "0",
    remaining_base_amount: entry.remaining_base_amount ?? "0",
    reduce_only: entry.reduce_only ?? false,
    status: "placed",
    created_at: entry.timestamp
      ? new Date(entry.timestamp / 1000).toISOString()
      : "",
  }
}

function parseSnapshot(orders: Record<string, WsSnapshotEntry[]>): PerpOrder[] {
  const result: PerpOrder[] = []
  if (!orders) return result
  for (const entries of Object.values(orders)) {
    for (const entry of entries) {
      result.push(snapshotEntryToOrder(entry))
    }
  }
  return result
}

function extractOrderIds(orders: Record<string, unknown[]>): number[] {
  const ids: number[] = []
  if (!orders) return ids
  for (const entries of Object.values(orders)) {
    for (const entry of entries) {
      const obj = entry as Record<string, unknown>
      if (typeof obj.order_id === "number") ids.push(obj.order_id)
      const nested = obj.order as Record<string, unknown> | undefined
      if (nested && typeof nested.order_id === "number")
        ids.push(nested.order_id)
    }
  }
  return ids
}

function hasNewOrders(orders: Record<string, unknown[]>): boolean {
  if (!orders) return false
  for (const entries of Object.values(orders)) {
    for (const entry of entries) {
      const obj = entry as Record<string, unknown>
      if (obj.order) return true
    }
  }
  return false
}

interface WsMessage {
  type: string
  orders: Record<string, unknown[]>
}

/**
 * Syncs open perp orders via WebSocket.
 * - subscribed/account_all_orders: full snapshot → replace store
 * - update/account_all_orders: cancel/fill → remove, new → resubscribe for snapshot
 * Also listens to account_all for order changes (maker side).
 * Call once at app level (page.tsx).
 */
// Module-level fetch — reusable by sync hook and refetch
// Fetch generation: the crude `_fetching` boolean used to DROP concurrent
// calls, which broke account switches — an in-flight fetch for the OLD wallet
// would block the NEW wallet's fetch and then overwrite the store with the old
// (usually empty) result. Instead we tag each fetch with a generation and only
// apply a response if it's still the latest, so stale results are ignored and
// no needed fetch is ever dropped.
let _fetchGen = 0
export async function fetchOpenOrders() {
  const gen = ++_fetchGen
  try {
    const raw = await apiClient<PerpOrdersRawResponse>("/perp/orders/open", {
      auth: true,
    })
    if (gen !== _fetchGen) return // superseded by a newer fetch or WS change
    useOpenOrdersStore.getState().setOrders(raw.orders.map(toPerpOrder))
  } catch {
    // silently fail
  }
}

/**
 * Discard any in-flight REST snapshot. Must be called right before applying a
 * WS-driven store change (fill/cancel removal, snapshot replace): a REST
 * response requested BEFORE that change carries the pre-fill order list, and
 * letting it land afterwards overwrites the store and RESURRECTS the removed
 * order — which then lingers forever, since no later event references it.
 */
export function supersedeOpenOrdersFetch() {
  _fetchGen++
}

export function useOpenPerpOrdersSync() {
  const { isAuthenticated } = useAuthContext()
  const { subscribe } = useWebSocket()
  const accountIndex = useAccountIndex()
  const resubscribeRef = useRef<(() => void) | null>(null)
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch open orders once the account is CONFIRMED — i.e. authenticated AND
  // `accountIndex` has resolved (non-null). This is the fix for "switch wallet
  // → orders empty until you change tabs":
  //
  // On a wallet switch the app logs out (isAuthenticated → false, the
  // `["account"]` query is cleared → accountIndex → null) then re-logs-in the
  // new wallet. Gating on `isAuthenticated` alone fetched too early — during
  // the transition, before the new session's cookies were live — so
  // `fetchOpenOrders` 401'd and silently failed (and its in-flight guard could
  // drop the good retry). By waiting for `accountIndex != null` we only fetch
  // AFTER the `["account"]` query has successfully loaded the new wallet (which
  // means the session is ready), exactly like the tab-switch remount does.
  useEffect(() => {
    if (!isAuthenticated) {
      useOpenOrdersStore.getState().setOrders([])
      return
    }
    if (accountIndex == null) return // wait for the account query to resolve
    fetchOpenOrders()
  }, [isAuthenticated, accountIndex])

  // WS: account_all_orders for snapshot + incremental updates
  useEffect(() => {
    if (accountIndex == null) return

    const channel = `account_all_orders/${accountIndex}`

    const doSubscribe = () => {
      return subscribe(channel, (raw: unknown) => {
        const msg = raw as WsMessage
        const store = useOpenOrdersStore.getState()

        if (msg.type === "subscribed/account_all_orders") {
          supersedeOpenOrdersFetch()
          store.setOrders(
            parseSnapshot(msg.orders as Record<string, WsSnapshotEntry[]>)
          )
          return
        }

        if (msg.type === "update/account_all_orders") {
          if (hasNewOrders(msg.orders)) {
            if (!throttleRef.current) {
              throttleRef.current = setTimeout(() => {
                throttleRef.current = null
                if (resubscribeRef.current) {
                  resubscribeRef.current()
                  resubscribeRef.current = doSubscribe()
                }
              }, 300)
            }
          } else {
            // Fill/cancel removal — authoritative and newer than any REST
            // snapshot already in flight, so discard those first (see
            // supersedeOpenOrdersFetch) or the stale response would re-add
            // the order right after we remove it.
            supersedeOpenOrdersFetch()
            const ids = extractOrderIds(msg.orders)
            for (const id of ids) {
              store.removeOrder(id)
            }
          }
        }
      })
    }

    resubscribeRef.current = doSubscribe()

    return () => {
      if (resubscribeRef.current) {
        resubscribeRef.current()
        resubscribeRef.current = null
      }
      if (throttleRef.current) {
        clearTimeout(throttleRef.current)
        throttleRef.current = null
      }
    }
  }, [accountIndex, subscribe])

  // WS: account_all for maker-side order events (throttled to 1s).
  // Trailing-edge REQUIRED, same as the positions hook: fill events burst, and
  // the LAST one (fill completed) is the one that matters — a leading-only
  // throttle dropped it, leaving the filled order in the list with nothing
  // left to trigger a refetch.
  const accountThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const accountPendingRef = useRef(false)

  useEffect(() => {
    if (accountIndex == null) return

    const refetchThrottled = () => {
      if (accountThrottleRef.current) {
        accountPendingRef.current = true
        return
      }
      fetchOpenOrders()
      accountThrottleRef.current = setTimeout(() => {
        accountThrottleRef.current = null
        if (accountPendingRef.current) {
          accountPendingRef.current = false
          refetchThrottled()
        }
      }, 1000)
    }

    const channel = `account_all/${accountIndex}`
    const unsubscribe = subscribe(channel, (raw: unknown) => {
      const msg = raw as { type: string }
      // Refetch on ANY account update, not just messages carrying an `orders`
      // key: when a resting limit order FILLS, the server's update announces
      // the position/balance change without an `orders` entry, so gating on it
      // skipped the refetch and the filled order sat in the list until the
      // next tab switch. The positions hook reacts to every `update/*` for the
      // same reason; the 1s trailing throttle keeps the extra load bounded.
      if (msg.type === "update/account_all") refetchThrottled()
    })

    return () => {
      unsubscribe()
      if (accountThrottleRef.current) clearTimeout(accountThrottleRef.current)
      accountThrottleRef.current = null
      accountPendingRef.current = false
    }
  }, [accountIndex, subscribe])
}

/**
 * Read open orders from Zustand store.
 */
export function useOpenPerpOrders() {
  const orders = useOpenOrdersStore((s) => s.orders)
  return {
    data: { orders },
    refetch: fetchOpenOrders,
  }
}
