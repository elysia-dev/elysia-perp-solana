// MEME — the SPL quote token for market 129 (SPY-PERP-MEME) on Solana
// devnet. Authoritative config: elysia-perp dev config.dev.toml
// [[deposit.solana.tokens]] — mint below, asset_id 9004, 6 decimals, rate 1/1
// ($1 peg, so a deposit credits 1:1 with no rounding). Classic SPL Token
// program (Token-2022 is rejected by the vault).

import { web3 } from "@coral-xyz/anchor"

const { PublicKey } = web3

export const MEME_MINT = new PublicKey(
  "SPYDv38dP1pKpXN6EUo6FHibBgjoJmFxhWbetsoA9VH"
)
export const MEME_ASSET_ID = 9004
export const MEME_DECIMALS = 6

// Classic SPL Token + Associated Token programs (well-known addresses). We
// derive the ATA ourselves rather than pull in @solana/spl-token, which would
// bundle a second @solana/web3.js whose PublicKey type conflicts with Anchor's.
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
)
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
)

/** Associated token account for (owner, mint) under the classic Token program. */
export function getAssociatedTokenAddress(
  mint: web3.PublicKey,
  owner: web3.PublicKey
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}

// The program is devnet-only; sending is fixed to devnet regardless of the
// wallet's selected cluster (signing is cluster-agnostic).
export const DEVNET_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com"

/** "View tx" link on the Solana explorer (devnet cluster). */
export function getExplorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`
}
