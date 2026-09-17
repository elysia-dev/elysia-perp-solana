export interface LoginRequest {
  // Wallet signature over the byte-exact login message. `timestamp` is the
  // client-generated single-use nonce (ms).
  //
  // EVM: EIP-191 personal_sign; the server recovers the signer via `ecrecover`
  // so `address` is omitted. Solana (hackathon build): ed25519 signMessage,
  // base58-encoded — ed25519 has no address recovery, so the signer's public
  // key MUST be sent in `address` for the server to verify against.
  signature: string
  timestamp: number
  address?: string
}

export interface LoginResponse {
  address: string
  access_expires_in: number
  refresh_expires_in: number
}

export interface RefreshResponse {
  address: string
  access_expires_in: number
  refresh_expires_in: number
}
