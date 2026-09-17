import { SolanaAdapter } from "@reown/appkit-adapter-solana/react"

// Solana side of the multi-chain Reown AppKit (added for the Solana hackathon
// track). The EVM app is unchanged — this only lets AppKit connect a Solana
// wallet alongside the wagmi/EVM adapter. Auth/trading remain EVM-only until
// the backend accepts Solana signatures.
//
// No explicit wallet adapters: modern Phantom/Solflare register through the
// Wallet Standard, so AppKit discovers them automatically. Passing the
// @solana/wallet-adapter-wallets classes instead pulls a second copy of
// @solana/wallet-adapter-base whose BaseWalletAdapter type is incompatible
// with the one Reown expects.
export const solanaAdapter = new SolanaAdapter({ wallets: [] })
