import { solana, solanaDevnet } from "@reown/appkit/networks"
import type { AppKitNetwork } from "@reown/appkit/networks"

// Solana network switch, driven by the build-time public env NEXT_PUBLIC_NETWORK.
//
//   NEXT_PUBLIC_NETWORK=production  → Solana mainnet-beta
//   anything else (testnet / dev / unset) → Solana devnet
//
// This is the single source of truth: the AppKit connect modal, the RPC used
// for balance reads and deposit tx sends, and the explorer "View tx" links all
// derive from it, so the whole app agrees on one cluster.
//
// NOTE: the vault program id (lib/solana/useSolDeposit.ts idl) and MEME_MINT
// (lib/solana/meme.ts) are DEVNET deployments. Switching this to mainnet only
// changes which cluster the wallet/RPC/explorer point at — the program and mint
// must be redeployed and their addresses updated before mainnet actually works.
export const IS_MAINNET =
  process.env.NEXT_PUBLIC_NETWORK === "production" ||
  process.env.NEXT_PUBLIC_NETWORK === "mainnet"

/** AppKit network object for the connect modal + the wallet's selected cluster. */
export const SOLANA_NETWORK: AppKitNetwork = IS_MAINNET ? solana : solanaDevnet

/** RPC endpoint for balance reads and deposit tx sends. Override per env. */
export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (IS_MAINNET
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com")

// Solana explorer cluster query for "View tx" links. Mainnet-beta is the
// explorer default, so it needs no query param; devnet must be explicit.
const EXPLORER_CLUSTER = IS_MAINNET ? "" : "?cluster=devnet"

/** "View tx" link on the Solana explorer for the active cluster. */
export function getExplorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER}`
}
