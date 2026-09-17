import { sepolia, giwaSepolia, defineChain } from "@reown/appkit/networks"
import { ASSET_IDS } from "@/lib/constants/assets"
import type { NetworkConfig } from "./network-config.types"

// Testnet-mode network config — selected by the `@network-config` alias when
// `NEXT_PUBLIC_NETWORK` is unset or anything other than "mainnet" (dev / v0 /
// local). Everything testnet-specific lives HERE so mainnet bundles never
// contain these chains or addresses (see network-config.types.ts).

// Arbitrum Sepolia with a dedicated Alchemy RPC: the public endpoint's
// baseFee estimation is flaky (see lib/contracts/gas.ts for the fee-override
// story), and pinning the RPC keeps reads/writes on a consistent provider.
const arbitrumSepolia = defineChain({
  id: 421_614,
  name: "Arbitrum Sepolia",
  caipNetworkId: "eip155:421614",
  chainNamespace: "eip155",
  nativeCurrency: {
    name: "Arbitrum Sepolia Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://arb-sepolia.g.alchemy.com/v2/Cm9b86CxcTnfyKuiOCxDA"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arbiscan",
      url: "https://sepolia.arbiscan.io",
      apiUrl: "https://api-sepolia.arbiscan.io/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 81930,
    },
  },
  testnet: true,
})

export const networkConfig: NetworkConfig = {
  // Order matters: AppKit treats index 0 as the primary network for
  // SSR/cookie-state. Sepolia leads (EL collateral, the default deposit
  // flow); Arbitrum Sepolia (MockARB, retired) and Giwa Sepolia (MockUSDC,
  // BTC-PERP-USDC — server ELP-400) follow so their deposits work without a
  // manual chain add.
  appKitNetworks: [sepolia, arbitrumSepolia, giwaSepolia],
  defaultNetwork: sepolia,
  primaryChainId: sepolia.id,

  contracts: {
    [sepolia.id]: {
      elysiaPerp: "0x4dbaAcb29928F0C324C836141742a33A28F66778",
      // EL MockToken. Kept as the default/back-compat collateral token address.
      collateralToken: "0x3080B6C3AeE68fa83Ec02f749BA8c4D0a963A7Dc",
    },
    [arbitrumSepolia.id]: {
      // ElysiaPerp UUPS proxy on Arbitrum Sepolia. Do not call the
      // implementation directly (0xEFf8…6E2) — always go through the proxy.
      elysiaPerp: "0xD387fF3de9Ebed5B5aF955d40Bbb245f91a6227c",
      // MockARB — the only deposit collateral on this chain today.
      collateralToken: "0x8e542B665DBa78b1313A4418281962d7190405E8",
    },
    [giwaSepolia.id]: {
      // ElysiaPerp UUPS proxy on Giwa Sepolia (OP-Stack, ~1s blocks).
      // Server side: ELP-400 — watched by dev/testnet configs only.
      elysiaPerp: "0xfE9a7603641e5Ac1cc155C62bAA7242dABf93B5a",
      // MockUSDC — collateral for BTC-PERP-USDC (asset 3408, 6 decimals).
      collateralToken: "0xB2bACB93a5046Fa2A9b5709CB06d41dAb0De6D37",
    },
  },

  collateralTokens: {
    [sepolia.id]: [
      {
        assetId: ASSET_IDS.EL,
        address: "0x3080B6C3AeE68fa83Ec02f749BA8c4D0a963A7Dc",
      },
      {
        assetId: ASSET_IDS.USDT,
        address: "0xA82Ac14ac0625461B2A2F00B18Af7b13e00af318",
      },
    ],
    [arbitrumSepolia.id]: [
      {
        assetId: ASSET_IDS.ARB,
        address: "0x8e542B665DBa78b1313A4418281962d7190405E8",
      },
    ],
    [giwaSepolia.id]: [
      {
        assetId: ASSET_IDS.USDC,
        address: "0xB2bACB93a5046Fa2A9b5709CB06d41dAb0De6D37",
      },
    ],
  },

  assetIdToChainId: {
    [ASSET_IDS.EL]: sepolia.id,
    [ASSET_IDS.USDT]: sepolia.id,
    [ASSET_IDS.ARB]: arbitrumSepolia.id,
    [ASSET_IDS.USDC]: giwaSepolia.id,
  },
  // USDT re-activated for USDKRW-PERP-USDT (server ELP-499 / PR #887 — the
  // FX market is quoted in USDT). USDC (Giwa) and ARB are retired from the
  // product but stay registered above for history-symbol resolution and
  // withdrawals of existing balances.
  activeCollateralAssetIds: [ASSET_IDS.EL, ASSET_IDS.USDT],

  // USDT trades only the USDKRW FX market (ELP-499) — BTC-PERP-USDT still
  // exists on dev but is retired, so the trade UI must never route to it.
  collateralBaseScope: { [ASSET_IDS.USDT]: ["USDKRW"] },

  explorerBaseUrl: {
    [sepolia.id]:
      sepolia.blockExplorers?.default?.url ?? "https://sepolia.etherscan.io",
    [arbitrumSepolia.id]: "https://sepolia.arbiscan.io",
    [giwaSepolia.id]:
      giwaSepolia.blockExplorers?.default?.url ??
      "https://sepolia-explorer.giwa.io",
  },
  chainNames: {
    [sepolia.id]: "Sepolia",
    [arbitrumSepolia.id]: "Arbitrum Sepolia",
    [giwaSepolia.id]: "Giwa Sepolia",
  },

  // Giwa Sepolia → 30 confirmations (~1s blocks; prices OP-Stack
  // sequencer-reorg risk — mirrors the server's `block_confirmations`).
  depositConfirmations: { [giwaSepolia.id]: 30 },
  // Arbitrum Sepolia ~300ms, Giwa Sepolia (OP-Stack) ~1s; others use the
  // 12s L1 default.
  blockTimeMs: { [arbitrumSepolia.id]: 300, [giwaSepolia.id]: 1_000 },

  // Live env-gated rails: MockARB on Arbitrum Sepolia (asset 11841) and
  // MockUSDC on Giwa Sepolia (asset 3408, quotes BTC-PERP-USDC).
  ecosystemQuoteAssetIds: { arbitrum: 11841, usdc: 3408 },
}
