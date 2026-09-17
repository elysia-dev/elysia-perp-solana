import { SolanaAdapter } from "@reown/appkit-adapter-solana/react"

// Solana adapter for Reown AppKit — the app's only wallet adapter. Connect,
// login (ed25519 signature), and deposits all run on Solana devnet.
//
// No explicit wallet adapters: modern Phantom/Solflare register through the
// Wallet Standard, so AppKit discovers them automatically. Passing the
// @solana/wallet-adapter-wallets classes instead pulls a second copy of
// @solana/wallet-adapter-base whose BaseWalletAdapter type is incompatible
// with the one Reown expects.
export const solanaAdapter = new SolanaAdapter({ wallets: [] })
