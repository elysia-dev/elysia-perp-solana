import { mainnet } from "@reown/appkit/networks"
import { ASSET_IDS } from "@/lib/constants/assets"
import type { NetworkConfig } from "./network-config.types"

// Mainnet-mode network config — selected by the `@network-config` alias when
// `NEXT_PUBLIC_NETWORK=mainnet` (staging / prod). This file must contain NO
// testnet chains or addresses: its whole point is that mainnet bundles ship
// zero bytes of testnet configuration (see network-config.types.ts).

// EL collateral on mainnet. Defaults to MockEL (staging/QA) but is
// env-overridable so prod can point at the real ELYSIA token
// (`0x2781246fe707bB15CeE3e5ea354e2154a2877B16`) where there's no Mint
// faucet — set `NEXT_PUBLIC_EL_TOKEN_ADDRESS` on the prod branch.
const EL_TOKEN = (process.env.NEXT_PUBLIC_EL_TOKEN_ADDRESS ||
  "0x9B08CB2E383788D251096039576C59eEEEd13723") as `0x${string}`

export const networkConfig: NetworkConfig = {
  appKitNetworks: [mainnet],
  defaultNetwork: mainnet,
  primaryChainId: mainnet.id,

  contracts: {
    [mainnet.id]: {
      // ElysiaPerp UUPS proxy on Ethereum mainnet. Env-overridable so each
      // mainnet env points at its own deployment (staging vs prod differ) —
      // set `NEXT_PUBLIC_ELYSIA_PERP_ADDRESS` per branch (prod =
      // `0x3C8643508c5568621CB6d21119e4076551522c84`). Falls back to the
      // original deployment when unset.
      elysiaPerp: (process.env.NEXT_PUBLIC_ELYSIA_PERP_ADDRESS ||
        "0x670BA8E6DbC9dbdf77F60aB965CB64c0ac239638") as `0x${string}`,
      collateralToken: EL_TOKEN,
    },
  },

  // EL is the sole live collateral on mainnet. USDT/ARB/USDC are deliberately
  // absent from every map here so any UI path keyed off them (deposit picker,
  // balance pill, history-row symbol fallback) treats them as unsupported and
  // never tries to read a non-existent mainnet contract.
  collateralTokens: {
    [mainnet.id]: [{ assetId: ASSET_IDS.EL, address: EL_TOKEN }],
  },
  assetIdToChainId: { [ASSET_IDS.EL]: mainnet.id },
  activeCollateralAssetIds: [ASSET_IDS.EL],

  // EL is the only live collateral and it is unscoped (valid for all bases).
  collateralBaseScope: {},

  explorerBaseUrl: {
    [mainnet.id]:
      mainnet.blockExplorers?.default?.url ?? "https://etherscan.io",
  },
  chainNames: { [mainnet.id]: "Ethereum" },

  // No per-chain overrides — Ethereum L1 uses the 15-confirmation / 12s
  // defaults baked into the accessors in lib/contracts/addresses.ts.
  depositConfirmations: {},
  blockTimeMs: {},

  // No ARB-on-mainnet or USDC-on-mainnet rails yet → both ecosystems read
  // "Soon" in the collateral selector.
  ecosystemQuoteAssetIds: {},
}
