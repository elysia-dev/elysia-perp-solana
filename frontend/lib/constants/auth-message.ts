import { PRIMARY_CHAIN_ID } from "./network"

// Login is wallet-signature auth via EIP-191 `personal_sign` (replaces the
// legacy EIP-712 typed-data flow). The client signs a human-readable message;
// the server rebuilds the identical bytes and recovers the signer
// (`ecrecover`) — the recovered address IS the authenticated identity, so no
// `address`/`nonce` is sent in the request body.
//
// `chain_id` is part of the signed bytes, which (a) reveals the network to the
// signer and (b) binds the signature to one environment (a dev-signed login
// cannot authenticate on prod). It MUST match the backend env's value — a
// build-time constant, NOT the wallet's currently-connected chain. Our
// `PRIMARY_CHAIN_ID` already encodes exactly this: mainnet → 1, testnet →
// 11155111 (Sepolia), matching the server's `login_chain_id()` table. In
// testnet mode a wallet connected to Arbitrum Sepolia (421614) must still sign
// with 11155111, so we deliberately use PRIMARY_CHAIN_ID and not the live chain.
export const LOGIN_CHAIN_ID = PRIMARY_CHAIN_ID

// Build the EXACT message to sign — do NOT reformat. The blank lines (`\n\n`)
// are part of the signed bytes; any drift changes the bytes → recovery yields
// a different address → 401. Must stay byte-for-byte identical to the server
// (see backend `docs/auth/eip191-login.md`).
export function buildLoginMessage(
  chainId: number,
  timestampMs: number
): string {
  return `Access Elysia Perp account.\n\nChain ID: ${chainId}\n\nTimestamp: ${timestampMs}`
}
