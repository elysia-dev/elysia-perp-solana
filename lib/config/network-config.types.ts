import type { AppKitNetwork } from "@reown/appkit/networks"

export interface ChainContracts {
  elysiaPerp: `0x${string}`
  collateralToken: `0x${string}`
}

export interface CollateralToken {
  assetId: number
  address: `0x${string}`
}

/**
 * Everything about "which family of chains does this build talk to", as one
 * typed object. Two implementations exist — `network-config.mainnet.ts` and
 * `network-config.testnet.ts` — and the `@network-config` alias (tsconfig
 * paths + next.config turbopack.resolveAlias) selects EXACTLY ONE at build
 * time based on `NEXT_PUBLIC_NETWORK`.
 *
 * WHY an alias instead of the old `IS_MAINNET ? A : B` ternaries: the
 * bundler does not constant-fold a cross-module runtime const, so both
 * branches shipped in every build — a mainnet (prod) bundle physically
 * contained the testnet chain registry (Giwa RPC endpoints, mock-token
 * addresses, …). With the alias the unselected config file is never part of
 * the module graph, so none of its bytes reach the other environment's
 * bundle.
 */
export interface NetworkConfig {
  /** Wallet networks for BOTH the wagmi adapter and the AppKit picker —
   *  single source so the two can never disagree. Order matters: AppKit
   *  treats index 0 as the primary network for SSR/cookie-state. */
  appKitNetworks: [AppKitNetwork, ...AppKitNetwork[]]
  /** AppKit's initial network (mainnet ↔ Sepolia). */
  defaultNetwork: AppKitNetwork
  /** Fallback / "primary" anchor chain id (Ethereum mainnet ↔ Sepolia). */
  primaryChainId: number
  /** ElysiaPerp proxy + default collateral token per chain. */
  contracts: Record<number, ChainContracts>
  /** Deposit/mint-able collateral tokens per chain (multi-token, ELP-133).
   *  Order drives the default selection in the deposit/mint modals. */
  collateralTokens: Record<number, CollateralToken[]>
  /** Reverse map: which chain hosts a given collateral asset_id. */
  assetIdToChainId: Record<number, number>
  /** Collaterals the deposit/mint UI actively OFFERS (retired ones stay in
   *  `collateralTokens` for history-symbol resolution + withdraw). */
  activeCollateralAssetIds: number[]
  /** Which market BASES a collateral (quote asset_id) may route to in the
   *  trade UI. Absent entry = valid for every base. Lets a collateral be
   *  active for deposits yet scoped to specific markets — e.g. testnet USDT
   *  is live only for USDKRW (ELP-499) while BTC-PERP-USDT is retired. */
  collateralBaseScope: Partial<Record<number, readonly string[]>>
  /** Chain id → block-explorer base URL. */
  explorerBaseUrl: Record<number, string>
  /** Human-readable chain labels for pickers/badges. */
  chainNames: Record<number, string>
  /** Per-chain deposit confirmation counts that differ from the 15 default —
   *  MUST mirror the server's `block_confirmations` (config.{env}.toml). */
  depositConfirmations: Record<number, number>
  /** Per-chain approximate block times that differ from the 12s L1 default. */
  blockTimeMs: Record<number, number>
  /** Live quote asset_id per ecosystem id (`lib/config/markets.ts`)
   *  for rails that are env-gated (arbitrum, usdc). Absent = "Soon". */
  ecosystemQuoteAssetIds: Record<string, number>
}
