import { SolanaAdapter } from "@reown/appkit-adapter-solana/react"

// Solana adapter for Reown AppKit — the app's only wallet adapter. Connect,
// login (ed25519 signature), and deposits run on the env-selected Solana
// cluster (see lib/solana/network.ts; devnet unless NEXT_PUBLIC_NETWORK=production).
//
// No explicit wallet adapters: modern Phantom/Solflare register through the
// Wallet Standard, so AppKit discovers them automatically. Passing the
// @solana/wallet-adapter-wallets classes instead pulls a second copy of
// @solana/wallet-adapter-base whose BaseWalletAdapter type is incompatible
// with the one Reown expects.
export const solanaAdapter = new SolanaAdapter({ wallets: [] })
