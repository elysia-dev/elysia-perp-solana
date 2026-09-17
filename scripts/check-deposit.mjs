// Reads recent activity on the devnet vault program / sol_vault PDA to confirm
// a deposit landed. No wallet needed — read-only RPC.

import * as anchor from "@coral-xyz/anchor"

const { Connection, PublicKey, LAMPORTS_PER_SOL } = anchor.web3
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"
const PROGRAM_ID = new PublicKey("6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy")
const connection = new Connection(RPC, "confirmed")

const [solVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("sol_vault")],
  PROGRAM_ID
)
console.log("sol_vault PDA :", solVault.toBase58())
const vaultBal = await connection.getBalance(solVault)
console.log("vault balance :", vaultBal / LAMPORTS_PER_SOL, "SOL")

console.log("\nrecent program transactions (newest first):")
const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, { limit: 8 })
for (const s of sigs) {
  const when = s.blockTime
    ? new Date(s.blockTime * 1000).toISOString()
    : "?"
  console.log(
    `  ${s.signature.slice(0, 12)}…  ${when}  ${s.err ? "ERR" : "ok"}`
  )
}

if (sigs[0]) {
  console.log("\nlatest tx detail:")
  const tx = await connection.getParsedTransaction(sigs[0].signature, {
    maxSupportedTransactionVersion: 0,
  })
  const keys = tx?.transaction.message.accountKeys ?? []
  const vaultIdx = keys.findIndex((k) => k.pubkey.toBase58() === solVault.toBase58())
  if (vaultIdx >= 0 && tx?.meta) {
    const delta =
      (tx.meta.postBalances[vaultIdx] - tx.meta.preBalances[vaultIdx]) /
      LAMPORTS_PER_SOL
    console.log("  vault balance change:", delta, "SOL")
  }
  console.log(
    "  explorer:",
    `https://explorer.solana.com/tx/${sigs[0].signature}?cluster=devnet`
  )
  console.log("  log lines:")
  for (const l of tx?.meta?.logMessages ?? []) console.log("   ", l)
}
