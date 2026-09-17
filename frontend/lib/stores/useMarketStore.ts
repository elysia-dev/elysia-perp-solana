import { create } from "zustand"
import { Pair } from "@/types"

// Solana hackathon build: the only surfaced market is SPY-PERP-MEME (MEME
// collateral, quote asset 9004). This placeholder mirrors the backend market
// (id 129) so the pre-load UI matches what loads.
const DEFAULT_PAIR: Pair = {
  id: 129,
  name: "SPY-PERP-MEME",
  market_type: "Perpetual",
  base: "US500",
  base_scale_k: 10000,
  taker_fee: 500,
  maker_fee: 200,
  quote: "MEME$",
  quote_scale_k: 100,
  base_currency: 9001,
  quote_currency: 9004,
}

interface MarketState {
  selectedPairId: number
  selectedPrice: string
  pairs: Pair[]
  /** True once the REAL market list has loaded from the backend. Until then
   *  `pairs` holds only DEFAULT_PAIR, whose name ("BTC-PERP") is the base
   *  form WITHOUT the collateral suffix — consumers that need the exact
   *  backend market name (e.g. the chart's candle-api requests, which some
   *  environments key strictly by full name) must wait for this flag or
   *  they'll fire requests for a market the server doesn't recognise. */
  marketsLoaded: boolean

  setSelectedPairId: (id: number) => void
  setSelectedPrice: (price: string) => void
  setPairs: (pairs: Pair[]) => void
}

export const useMarketStore = create<MarketState>((set) => ({
  selectedPairId: DEFAULT_PAIR.id,
  selectedPrice: "",
  pairs: [DEFAULT_PAIR],
  marketsLoaded: false,

  setSelectedPairId: (id) => set({ selectedPairId: id }),
  setSelectedPrice: (price) => set({ selectedPrice: price }),
  setPairs: (pairs) => set({ pairs, marketsLoaded: true }),
}))

// Selector: derive the currently selected Pair object
export const selectSelectedPair = (state: MarketState): Pair => {
  return (
    state.pairs.find((p) => p.id === state.selectedPairId) ??
    state.pairs[0] ??
    DEFAULT_PAIR
  )
}

// Convenience hook
export function useSelectedPair(): Pair {
  return useMarketStore(selectSelectedPair)
}
