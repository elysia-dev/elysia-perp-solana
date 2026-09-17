export const ASSET_IDS = {
  USD: 840,
  BTC: 3762,
  ETH: 3928,
  USDT: 825,
  USDC: 3408,
  EL: 5382,
  ARB: 11841,
  // FX base for USDKRW-PERP-USDT (ELP-499). Without this entry
  // `getAssetName(9003)` returns "Unknown", which poisons `Pair.base` and
  // breaks every base-keyed path (market selector, chart symbol, display).
  USDKRW: 9003,
  // RWA base for SPY-PERP-EL (server market 128, EL-quanto).
  SPY: 9001,
} as const

export interface AssetMeta {
  /** Display symbol (perp-collateral tokens keep the trailing "$"). */
  symbol: string
  /** Icon path under public/. */
  icon: string
}

const FALLBACK_ICON = "/icons/tokens/el.svg"

/**
 * Per-asset display metadata, keyed by asset_id. Multi-token (ELP-133) added
 * USDT (825). Note: 825 is USDT and 5382 is EL — they are distinct tokens.
 */
export const ASSET_META: Record<number, AssetMeta> = {
  840: { symbol: "USD", icon: "/icons/tokens/usdt.svg" },
  825: { symbol: "USDT", icon: "/icons/tokens/usdt.svg" },
  3408: { symbol: "USDC", icon: "/icons/tokens/usdc.svg" },
  3762: { symbol: "BTC", icon: "/icons/tokens/btc.svg" },
  3928: { symbol: "ETH", icon: "/icons/tokens/eth.svg" },
  5382: { symbol: "EL$", icon: "/icons/tokens/el.svg" },
  5426: { symbol: "SOL$", icon: "/icons/collateral_logos/solana.svg" },
  // MEME$ — dollar-denominated collateral (quote of SPY-PERP-MEME, market
  // 129). 6-decimal $1 peg; a MEME token deposit credits MEME$ here 1:1.
  // The wallet-held SPL token is "MEME"; the ledger unit is "MEME$" (same
  // EL / EL$ split).
  9004: { symbol: "MEME$", icon: "/icons/collateral_logos/solana.svg" },
  11841: { symbol: "ARB", icon: "/icons/collateral_logos/arbitrum_logo.svg" },
  9003: { symbol: "USDKRW", icon: "/icons/tokens/usdkrw.svg" },
  // Display name is US500 (design 2026-09-08); server market stays SPY-PERP-EL.
  9001: { symbol: "US500", icon: "/icons/tokens/us500.svg" },
}

export function getAssetMeta(assetId: number): AssetMeta {
  return ASSET_META[assetId] ?? { symbol: "Unknown", icon: FALLBACK_ICON }
}

export function getAssetIcon(assetId: number): string {
  return ASSET_META[assetId]?.icon ?? FALLBACK_ICON
}
