"use client"

import { useEffect, useMemo, useRef } from "react"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useMarketStore, selectSelectedPair } from "@/lib/stores/useMarketStore"
import { useMarkPriceStore } from "@/lib/stores/useMarkPriceStore"
import {
  useMarketModeStore,
  isMarketMode,
} from "@/lib/stores/useMarketModeStore"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import type { MarkPriceResponse } from "@/types"
import { FUNDING_RATE_TICK } from "@/lib/constants/scaling"

interface MarketStatsMessage {
  type: string
  channel?: string
  market_stats: {
    market_id: number
    market: string
    mark_price: number
    index_price: number
    interest_rate_ticks: number
    open_interest: number
    daily_quote_token_volume: number
    daily_base_token_volume: number
    daily_price_change: number // percentage (e.g. -2.67)
    daily_price_high: number // already human-readable (e.g. 70870.7)
    daily_price_low: number // already human-readable (e.g. 68111.4)
    funding_clamp_big: number
    /** ELP-499: "active" | "reduce_only" | "halted" — FX-session/oracle
     *  state. Always "active" for ordinary 24/7 markets. */
    market_mode?: string
  }
  timestamp: number
}

/**
 * Subscribes to market_stats/{market_id} via WebSocket for each relevant market.
 * Converts raw u64 prices using price_decimals from orderBookDetails.
 * Syncs results into the Zustand MarkPriceStore.
 *
 * Subscription is reconciled by **diff**, not "tear down + rebuild": only newly
 * added market_ids subscribe and only removed ones unsubscribe. This matters
 * because the inputs that drive `allMarketIds` include auth-bound data
 * (`positions`, open orders), so logging in/out reshuffles the set even when
 * the user's actually-watched market (`selectedPair`) didn't change. A blanket
 * unsubscribe+resubscribe on every effect run was tearing down the
 * `selectedPair` channel too, and the visible MarketStats row would flash to
 * `0` until the next periodic server push refilled the store.
 */
export function useMarkPriceSync() {
  const positions = usePositionsList()
  const selectedPair = useMarketStore((s) => selectSelectedPair(s))
  const { data: openOrdersData } = useOpenPerpOrders()
  const { data: detailsData } = useOrderBookDetails()
  const { subscribe } = useWebSocket()

  // Build market_id → { symbol, priceDecimals } map from orderBookDetails
  const marketInfoMap = useMemo(() => {
    const map = new Map<number, { symbol: string; priceDecimals: number }>()
    detailsData?.order_book_details?.forEach((d) => {
      map.set(d.market_id, {
        symbol: d.symbol,
        priceDecimals: d.price_decimals,
      })
    })
    return map
  }, [detailsData])

  const pairs = useMarketStore((s) => s.pairs)

  // Collect all unique market_ids that need mark prices
  const allMarketIds = useMemo(() => {
    const ids = new Set<number>()

    // Current market
    if (selectedPair.id > 0) {
      ids.add(selectedPair.id)
    }

    // EVERY live market — the market selector shows price/24h per row, and
    // rows without a subscription rendered "-" (only the selected market had
    // data). The live market count is single digits and market_stats is one
    // small frame per second per market, so blanket subscription is cheap;
    // it also makes `allMarketIds` a stable superset, so switching markets
    // no longer adds/removes channels at all.
    pairs.forEach((p) => {
      if (p.id > 0) ids.add(p.id)
    })

    // All positions — find market_id by symbol
    positions.forEach((pos) => {
      for (const [mid, info] of marketInfoMap) {
        if (info.symbol === pos.market) {
          ids.add(mid)
          break
        }
      }
    })

    // All open orders
    openOrdersData?.orders?.forEach((order) => {
      for (const [mid, info] of marketInfoMap) {
        if (info.symbol === order.market) {
          ids.add(mid)
          break
        }
      }
    })

    return Array.from(ids)
  }, [selectedPair.id, pairs, positions, openOrdersData, marketInfoMap])

  // `subscribe` identity can churn (its useCallback deps include auth-bound
  // fetchTokenAndSubscribe). Reading via ref keeps the reconciliation effect
  // free of `subscribe` in its deps so we don't tear down healthy channels
  // every time the WS provider rebuilds its callback.
  const subscribeRef = useRef(subscribe)
  useEffect(() => {
    subscribeRef.current = subscribe
  }, [subscribe])

  // marketId → unsubscribe fn. Lives across re-renders so we can diff against
  // it. Each entry survives until its market_id leaves `allMarketIds`.
  const activeUnsubsRef = useRef<Map<number, () => void>>(new Map())

  // Reconcile subscriptions against `allMarketIds` (diff-based add/remove).
  useEffect(() => {
    const active = activeUnsubsRef.current
    const desired = new Set(allMarketIds)

    // 1) Add — new ids that aren't currently subscribed.
    for (const marketId of allMarketIds) {
      if (active.has(marketId)) continue

      const info = marketInfoMap.get(marketId)
      const priceDecimals = info?.priceDecimals ?? 1
      const channel = `market_stats/${marketId}`

      const unsubscribe = subscribeRef.current(channel, (raw: unknown) => {
        const msg = raw as MarketStatsMessage
        const stats = msg.market_stats
        if (!stats) return

        // ELP-499: FX-session markets carry a trading mode on every frame
        // (active / reduce_only / halted). Store dedupes unchanged values,
        // so this is effectively free for 24/7 markets that never leave
        // "active". When the mode isn't "active" the mark_price in this
        // same frame is NOT trustworthy per the server team — consumers
        // gate on the mode via useMarketMode.
        if (isMarketMode(stats.market_mode)) {
          useMarketModeStore.getState().setMode(marketId, stats.market_mode)
        }

        const symbol = info?.symbol ?? stats.market

        const divisor = Math.pow(10, priceDecimals)
        // Backend oracle scale workaround (SPY-PERP-MEME): the oracle mark/index
        // arrive 10x too high versus the actual SPY price and the trade/candle
        // feed, which would also blow up PnL against ~763-level entry prices.
        // Correct on the client until the backend fixes the oracle scale.
        // Applied to price fields only — NOT open interest (a size, not a price).
        const oracleScaleFix = stats.market === "SPY-PERP-MEME" ? 10 : 1
        const markPrice = stats.mark_price / divisor / oracleScaleFix
        const indexPrice = stats.index_price / divisor / oracleScaleFix

        const openInterest = stats.open_interest / divisor
        const dailyQuoteVolume = stats.daily_quote_token_volume ?? 0
        // interest_rate_ticks is in FUNDING_RATE_TICK units (1 tick = 0.0001%).
        // ticks / FUNDING_RATE_TICK = fraction → * 100 to get percent.
        const fundingRate =
          (stats.interest_rate_ticks / FUNDING_RATE_TICK) * 100
        // funding_clamp_big is the 8hr cap in ticks; /8 for 1hr cap in percent.
        const fundingClampBig1hr =
          ((stats.funding_clamp_big ?? 40_000) / 8 / FUNDING_RATE_TICK) * 100

        const priceData: MarkPriceResponse = {
          symbol,
          mark_price: markPrice.toString(),
          index_price: indexPrice.toString(),
          open_interest: openInterest.toString(),
          daily_volume: dailyQuoteVolume.toString(),
          daily_base_volume: (stats.daily_base_token_volume ?? 0).toString(),
          daily_change: (stats.daily_price_change ?? 0).toString(),
          daily_high: (stats.daily_price_high ?? 0).toString(),
          daily_low: (stats.daily_price_low ?? 0).toString(),
          funding_rate: fundingRate.toString(),
          funding_cap_1hr: fundingClampBig1hr.toString(),
          updated_at: new Date(msg.timestamp).toISOString(),
        }

        // Patch this one symbol. The store's per-symbol setter keeps every
        // *other* entry's value reference intact, so subscribers selecting
        // a different symbol skip the re-render via Object.is.
        useMarkPriceStore.getState().setMarkPrice(symbol, priceData)
      })

      active.set(marketId, unsubscribe)
    }

    // 2) Remove — currently active ids that are no longer desired.
    // We only prune *those* symbols' rows; everything still desired is left
    // alone in the store, so the user's selected market never flashes to 0.
    const droppedSymbols = new Set<string>()
    for (const [marketId, unsub] of active) {
      if (desired.has(marketId)) continue
      unsub()
      active.delete(marketId)
      const symbol = marketInfoMap.get(marketId)?.symbol
      if (symbol) droppedSymbols.add(symbol)
    }

    if (droppedSymbols.size > 0) {
      const store = useMarkPriceStore.getState()
      const keep = new Set<string>()
      for (const symbol of store.markPrices.keys()) {
        if (!droppedSymbols.has(symbol)) keep.add(symbol)
      }
      store.pruneMarkPrices(keep)
    }

    // No cleanup here on purpose. Channels we still need must stay subscribed
    // across re-runs of this effect — that's the whole point of the diff.
  }, [allMarketIds, marketInfoMap])

  // Unmount-only teardown. Closes every remaining channel and clears the ref
  // so a remount starts from an empty active set.
  useEffect(() => {
    return () => {
      const active = activeUnsubsRef.current
      for (const unsub of active.values()) unsub()
      active.clear()
    }
  }, [])
}
