"use client"

import { useEffect } from "react"
import { useMarkets } from "@/lib/hooks/useMarkets"
import { useMarketStore } from "@/lib/stores/useMarketStore"
import { Market } from "@/types"
import { getAssetName } from "@/lib/utils"

/**
 * Syncs React Query market data into the Zustand MarketStore.
 * Call this once at the top level (e.g., page.tsx).
 *
 * Returns a coalesced `isLoading` that only stays true on the *first*
 * fetch, before there's any cached market list. Once the Zustand store
 * has any pairs cached, we keep returning `false` even while a background
 * refetch is in flight — otherwise wake-from-sleep refetches would
 * re-trigger the page-level "Loading markets…" branch and the user would
 * see the gated spinner again on every reconnect attempt.
 *
 * Also surfaces `isError` and `refetch` so the page can show a clear
 * "couldn't load markets" affordance instead of a permanently spinning
 * loader when the backend is unreachable.
 */
export function useMarketSync() {
  const { data: marketsData, isLoading, isError, refetch } = useMarkets()
  const hasCachedPairs = useMarketStore((s) => s.pairs.length > 0)

  useEffect(() => {
    if (marketsData) {
      const pairs = marketsData
        .filter((market: Market) => market.market_type === "Perpetual")
        // Solana hackathon build: surface only the MEME-collateralised market.
        .filter((market: Market) => market.name === "SPY-PERP-MEME")
        .map((market: Market) => ({
          id: market.market_id,
          market_type: market.market_type,
          name: market.name,
          base: getAssetName(market.base_currency),
          base_scale_k: market.base_scale_k,
          taker_fee: market.taker_fee,
          maker_fee: market.maker_fee,
          quote:
            getAssetName(market.quote_currency) === "Unknown"
              ? "EL$"
              : getAssetName(market.quote_currency),
          quote_scale_k: market.quote_scale_k,
          base_currency: market.base_currency,
          quote_currency: market.quote_currency,
        }))
      useMarketStore.getState().setPairs(pairs)
    }
  }, [marketsData])

  return {
    isLoading: isLoading && !hasCachedPairs,
    isError: isError && !hasCachedPairs,
    refetch,
  }
}
