"use client"

import { useEffect, useMemo, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { accountQueryOptions, ACCOUNT_QUERY_KEY } from "@/lib/api/accountQuery"
import type {
  Account,
  AccountPosition,
  AccountResponse,
  Position,
  PositionsResponse,
  TokenBalance,
} from "@/types"
import { useAuthContext } from "../providers/AuthProvider"
import { useWebSocket } from "../providers/WebSocketProvider"

/**
 * Derives position data from the /account endpoint.
 * The old /positions route is replaced by the unified /account response.
 */
export function usePositions() {
  const { isAuthenticated } = useAuthContext()
  const queryClient = useQueryClient()
  const { subscribe } = useWebSocket()

  const { data: accountData, ...rest } = useQuery(
    accountQueryOptions(isAuthenticated)
  )
  // Read the account index straight from the query data this hook already
  // owns — no Zustand mirror, no ordering dependency on a sync effect.
  const accountIndex = accountData?.accounts?.[0]?.index ?? null

  // Invalidate on WS updates (throttled: max once per second).
  // Trailing-edge REQUIRED: updates inside the 1s window must not be dropped,
  // only deferred. The last update after an action is often the one that
  // matters (e.g. the position-close fill settling) and nothing follows it —
  // with a leading-only throttle it was silently lost, leaving the closed
  // position on screen until some unrelated account event arrived.
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (accountIndex == null) return

    const invalidate = () => {
      if (throttleRef.current) {
        pendingRef.current = true
        return
      }
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null
        if (pendingRef.current) {
          pendingRef.current = false
          invalidate()
        }
      }, 1000)
    }

    // Apply a full `subscribed/account_all` snapshot directly into the
    // `["account"]` cache. The snapshot's `balances`/`positions` come from the
    // SAME backend builder as GET /account (`build_account_snapshot` →
    // `TokenBalance` / `AccountPositionInfo`), so the field shapes are
    // identical and we can patch `accounts[0]` in place instead of throwing
    // the data away and refetching. This removes a WS→REST round-trip and
    // makes Avbl/positions reflect instantly — including the deposit-credit
    // self-heal the server pushes on (re)subscribe / tab focus.
    //
    // `account_type` / `l1_address` aren't carried in the snapshot, so we keep
    // whatever's already cached (REST sets them to 0 / "" anyway).
    const applySnapshot = (msg: Record<string, unknown>) => {
      queryClient.setQueryData<AccountResponse>(ACCOUNT_QUERY_KEY, (prev) => {
        const base = prev?.accounts?.[0]
        const nextAccount: Account = {
          account_type: base?.account_type ?? 0,
          index:
            typeof msg.account === "number" ? msg.account : (base?.index ?? 0),
          l1_address: base?.l1_address ?? "",
          total_order_count:
            typeof msg.total_order_count === "number"
              ? msg.total_order_count
              : (base?.total_order_count ?? 0),
          balances: msg.balances as TokenBalance[],
          positions: msg.positions as AccountPosition[],
        }
        const accounts = prev?.accounts
          ? [nextAccount, ...prev.accounts.slice(1)]
          : [nextAccount]
        return {
          code: prev?.code ?? 0,
          total: prev?.total ?? accounts.length,
          accounts,
        }
      })
    }

    const unsubscribe = subscribe(
      `account_all/${accountIndex}`,
      (raw: unknown) => {
        const msg = raw as Record<string, unknown>
        if (typeof msg.type !== "string") return

        // Full snapshot with well-formed arrays → write straight to cache (no
        // refetch). Carries the current `balances` + `positions`.
        if (
          msg.type === "subscribed/account_all" &&
          Array.isArray(msg.balances) &&
          Array.isArray(msg.positions)
        ) {
          applySnapshot(msg)
          return
        }

        // Incremental `update/*` deltas are partial and shaped differently, so
        // the safe path remains a throttled refetch. A malformed snapshot
        // (missing arrays) also falls through to this fallback.
        if (
          msg.type.startsWith("update/") ||
          msg.type === "subscribed/account_all"
        ) {
          invalidate()
        }
      }
    )

    return () => {
      unsubscribe()
      // Reset the throttle fully: clearing the timeout without nulling the ref
      // would leave it truthy forever (the reset callback never runs), which
      // permanently swallows every future WS invalidation after a re-run.
      if (throttleRef.current) clearTimeout(throttleRef.current)
      throttleRef.current = null
      pendingRef.current = false
    }
  }, [accountIndex, subscribe, queryClient])

  const data = useMemo<PositionsResponse | undefined>(() => {
    const account = accountData?.accounts?.[0]

    if (!account) return undefined

    const positions: Position[] = account.positions
      // Numeric check, NOT string equality: the server has historically sent
      // empty sizes as both bare "0" and fixed-width "0.00000", and the
      // fixed-width form's digit count follows the market's base scale — a
      // literal list can never keep up. parseFloat treats every form the same.
      .filter((p) => parseFloat(p.position) !== 0)
      .map((p) => {
        const unrealizedPnl = parseFloat(p.unrealized_pnl) || 0
        const margin = parseFloat(p.allocated_margin) || 0
        const roe = margin > 0 ? (unrealizedPnl / margin) * 100 : 0
        // mark_price: derive from position_value / size
        const size = parseFloat(p.position) || 0
        const positionValue = parseFloat(p.position_value) || 0
        const markPrice = size > 0 ? positionValue / size : 0

        return {
          id: p.market_id,
          market: p.symbol,
          quote_asset_id: p.quote_asset_id,
          side: p.sign >= 0 ? ("Long" as const) : ("Short" as const),
          size: p.position,
          entry_price: p.avg_entry_price,
          mark_price: markPrice.toString(),
          margin: p.allocated_margin,
          leverage: p.initial_margin_fraction,
          unrealized_pnl: p.unrealized_pnl,
          roe: `${roe.toFixed(2)}%`,
          liquidation_price: p.liquidation_price,
          funding_pnl: p.funding_pnl,
          created_at: "",
        }
      })

    return { positions }
  }, [accountData])

  return { data, ...rest }
}

const EMPTY_POSITIONS: Position[] = []

/** Structural fingerprint that intentionally ignores PnL / mark fluctuations. */
function positionsStructuralKey(positions: Position[]): string {
  return positions
    .map((p) => `${p.market}:${p.side}:${p.size}:${p.entry_price}:${p.margin}`)
    .join("|")
}

/**
 * Stable list of open positions, read from the `["account"]` query.
 *
 * Replaces the old `usePositionStore` Zustand mirror (which was fed by a
 * separate `usePositionSync` effect). The identity of the returned array only
 * changes on a *structural* change (market / side / size / entry / margin) —
 * PnL and mark-price ticks don't churn it. That's safe because every consumer
 * computes live PnL/ROE/value from the mark-price store, not from these
 * (frozen) fields, so this preserves the previous render behaviour exactly
 * while removing the second source of truth and the sync-ordering hop.
 */
export function usePositionsList(): Position[] {
  const { data } = usePositions()
  const positions = data?.positions ?? EMPTY_POSITIONS
  const key = positionsStructuralKey(positions)
  // Freeze identity across PnL-only changes: recompute only when `key` moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => positions, [key])
}

/** The open position for a single market, or `undefined`. */
export function useCurrentMarketPosition(market: string): Position | undefined {
  const positions = usePositionsList()
  return useMemo(
    () => positions.find((p) => p.market === market),
    [positions, market]
  )
}
