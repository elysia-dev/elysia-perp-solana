import { networkConfig } from "@network-config"
import { ASSET_IDS } from "@/lib/constants/assets"

// Facade over the env-selected network config (`@network-config` — see
// lib/config/network-config.types.ts for the alias mechanism). This module
// keeps the same public API the rest of the app always imported; only the
// SOURCE of the data moved: instead of `IS_MAINNET ? A : B` ternaries that
// shipped both environments' chain registries in every bundle, the data now
// comes from whichever config file the build selected — a mainnet bundle
// physically contains zero testnet configuration.

export type {
  ChainContracts,
  CollateralToken,
} from "@/lib/config/network-config.types"

/** ElysiaPerp proxy + default collateral token per chain. */
export const CONTRACTS = networkConfig.contracts

/**
 * Deposit/mint-able collateral tokens per chain (multi-token, ELP-133).
 * Order here drives the default selection in the deposit/mint modals.
 */
export const COLLATERAL_TOKENS = networkConfig.collateralTokens

/**
 * Reverse map: which chain hosts a given collateral asset_id?
 * Used by the deposit/withdraw UI to switch the wallet to the right
 * network when the user selects a non-current-chain token.
 */
export const ASSET_ID_TO_CHAIN_ID = networkConfig.assetIdToChainId

/**
 * Collaterals the deposit/mint UI actively OFFERS. Retired tokens (USDT/ARB)
 * deliberately stay in `COLLATERAL_TOKENS`: deposit-history rows resolve
 * their symbol via `findCollateralByAddress`, and the withdraw modal must
 * still let users pull out balances they already hold. Filtering happens at
 * the picker level, not the registry level.
 */
export const ACTIVE_COLLATERAL_ASSET_IDS =
  networkConfig.activeCollateralAssetIds

export function getTokenAddress(
  chainId: number,
  assetId: number
): `0x${string}` | undefined {
  return COLLATERAL_TOKENS[chainId]?.find((t) => t.assetId === assetId)?.address
}

export function getAssetIdByTokenAddress(
  chainId: number,
  address: string
): number | undefined {
  const lower = address.toLowerCase()
  return COLLATERAL_TOKENS[chainId]?.find(
    (t) => t.address.toLowerCase() === lower
  )?.assetId
}

/**
 * Find a collateral token's `{ assetId, chainId }` from its raw contract
 * address, searching across *every* registered chain.
 *
 * The deposit history endpoint returns `token_address` with no chain
 * hint, and a single user can have deposited on multiple chains
 * (EL/USDT on Sepolia, ARB on Arbitrum Sepolia, …). Looking up against
 * one hardcoded chain (the old `getAssetIdByTokenAddress(sepolia.id, …)`
 * pattern) misses every deposit made on the other chain and silently
 * falls back to the wrong symbol — e.g. ARB deposits being rendered as
 * "EL$" in the deposits table.
 */
export function findCollateralByAddress(
  address: string
): { assetId: number; chainId: number } | undefined {
  const lower = address.toLowerCase()
  for (const [chainIdStr, tokens] of Object.entries(COLLATERAL_TOKENS)) {
    const match = tokens.find((t) => t.address.toLowerCase() === lower)
    if (match) {
      return { assetId: match.assetId, chainId: Number(chainIdStr) }
    }
  }
  return undefined
}

/**
 * Build a "View tx" link for the given chain. Falls back to the current
 * env's primary chain explorer when the chain is unknown — the link will
 * 404 on the wrong network but at least the user gets *some* affordance
 * instead of a broken `href`. Until this helper existed every history row
 * hard-coded `https://sepolia.etherscan.io/tx/${tx_hash}`, which silently
 * sent ARB deposit/withdraw clicks to a Sepolia search that never resolved.
 */
export function getExplorerTxUrl(
  chainId: number | undefined,
  txHash: string
): string {
  const base =
    (chainId != null && networkConfig.explorerBaseUrl[chainId]) ??
    networkConfig.explorerBaseUrl[networkConfig.primaryChainId]
  return `${base}/tx/${txHash}`
}

/** Human-readable chain labels for pickers/badges. */
export function getChainName(chainId: number | undefined): string {
  return (
    (chainId != null && networkConfig.chainNames[chainId]) || `Chain ${chainId}`
  )
}

/**
 * Deposit conversion rate: how many wallet tokens equal $1 of perp
 * collateral. Mirrors the server's `rate_num/rate_den` (USD per token):
 *   EL   → $0.01/token → 100 EL  = $1
 *   ARB  → $0.10/token →  10 ARB = $1
 *   USDT/USDC → $1/token →  1:1
 * Unknown assets default to 1:1 (same as the server's default rate).
 * Pure asset-id → number data (no chain addresses), so it is env-independent
 * and lives here rather than in the per-env config files.
 */
export const TOKENS_PER_DOLLAR: Record<number, number> = {
  [ASSET_IDS.EL]: 100,
  [ASSET_IDS.ARB]: 10,
  [ASSET_IDS.USDT]: 1,
  [ASSET_IDS.USDC]: 1,
}

export function getTokensPerDollar(assetId: number): number {
  return TOKENS_PER_DOLLAR[assetId] ?? 1
}

/**
 * Minimum deposit, expressed as a $10-equivalent in wallet tokens so every
 * collateral has the same effective floor: EL 1,000 (the original hardcoded
 * minimum), ARB 100, USDT/USDC 10. Keeping it derived from the rate means a
 * new collateral only needs a TOKENS_PER_DOLLAR entry.
 */
const MIN_DEPOSIT_USD = 10

export function getMinDepositTokens(assetId: number): number {
  return MIN_DEPOSIT_USD * getTokensPerDollar(assetId)
}

/**
 * Per-chain deposit confirmation policy — MUST mirror the server's
 * `block_confirmations` (config.{env}.toml): the deposit is credited only
 * after the server has seen this many blocks, so the UI's "N/M" gauge and the
 * background balance-refresh must count to the same M. Chains without an
 * override use the 15-block global default.
 */
export function getDepositConfirmations(chainId: number | undefined): number {
  return (chainId != null && networkConfig.depositConfirmations[chainId]) || 15
}

/**
 * Approximate block time per chain, for the crediting-step ETA countdown.
 * Chains without an override use the ~12s Ethereum L1 slot time.
 */
export function getBlockTimeMs(chainId: number | undefined): number {
  return (chainId != null && networkConfig.blockTimeMs[chainId]) || 12_000
}
