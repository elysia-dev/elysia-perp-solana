"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { useMarketStore } from "@/lib/stores/useMarketStore"
import {
  useMarketModeStore,
  isMarketMode,
  type MarketMode,
} from "@/lib/stores/useMarketModeStore"

interface MarketOracleResponse {
  market_id: number
  market: string
  market_mode: string
  /** null for ordinary 24/7 markets (never registered with the RWA session
   *  state machine). "fresh" when healthy, "halted" when untrusted. */
  oracle_state: string | null
  /** Set only while oracle_state is "halted":
   *  disconnected | stale | low_confidence | invalid. Diagnostic only. */
  halt_reason: string | null
}

/**
 * Live trading mode for a market (ELP-499). Recommended pattern from the
 * server team: REST once on mount for the initial value, then WS-only —
 * `market_stats/{market_id}` frames (handled in useMarkPriceSync) update the
 * store every second, so no polling is needed and reconnect gaps self-heal.
 *
 * Returns "active" while unknown: 24/7 markets never leave active, and for
 * FX markets the seed/WS value lands within a second — a brief optimistic
 * "active" beats flashing a scary banner on every mount. The server remains
 * the final gate either way (rejections carry MARKET_HALTED /
 * MARKET_REDUCE_ONLY reason codes surfaced via toOrderErrorReason).
 */
export function useMarketMode(
  marketId: number,
  marketName: string
): MarketMode {
  const stored = useMarketModeStore((s) => s.modes[marketId])
  // Gate the seed on the real market list: before it loads the selected pair
  // is the DEFAULT_PAIR placeholder whose name lacks the collateral suffix,
  // and the oracle endpoint only knows full names (same reasoning as the
  // trades/candles fetch gates).
  const marketsLoaded = useMarketStore((s) => s.marketsLoaded)

  const { data } = useQuery({
    queryKey: ["marketOracle", marketName],
    queryFn: () =>
      apiClient<MarketOracleResponse>(
        `/markets/${encodeURIComponent(marketName)}/oracle`
      ),
    // Seed only while the store has nothing for this market — once WS frames
    // flow the query stays disabled for good.
    enabled: marketsLoaded && marketId > 0 && stored == null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  useEffect(() => {
    if (data && data.market_id === marketId && isMarketMode(data.market_mode)) {
      useMarketModeStore.getState().setMode(marketId, data.market_mode)
    }
  }, [data, marketId])

  return stored ?? "active"
}
