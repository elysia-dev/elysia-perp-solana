// Exercises the SAME anchor call as lib/solana/useSolDeposit against the live
// devnet program, using a throwaway keypair (no browser wallet). Proves the
// instruction/accounts/PDAs/credit_to shape is accepted on-chain.
//
//   node scripts/test-deposit.mjs
//   SOLANA_RPC_URL=<alchemy-devnet-url> node scripts/test-deposit.mjs   # avoid public throttle
//   KEYPAIR=/path/to/id.json node scripts/test-deposit.mjs             # reuse a funded key

import * as anchor from "@coral-xyz/anchor"
import fs from "node:fs"

const { Connection, Keypair, LAMPORTS_PER_SOL } = anchor.web3

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com"
const idl = JSON.parse(
  fs.readFileSync(new URL("../lib/solana/idl/elysia_perp.json", import.meta.url))
)

const connection = new Connection(RPC, "confirmed")

// Keypair: KEYPAIR env → that file; else a persisted throwaway at
// scripts/.deposit-test-key.json so the funded address survives reruns.
const DEFAULT_KEY = new URL("./.deposit-test-key.json", import.meta.url)
let kp
if (process.env.KEYPAIR) {
  kp = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(process.env.KEYPAIR, "utf8")))
  )
} else if (fs.existsSync(DEFAULT_KEY)) {
  kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(DEFAULT_KEY, "utf8"))))
} else {
  kp = Keypair.generate()
  fs.writeFileSync(DEFAULT_KEY, JSON.stringify(Array.from(kp.secretKey)))
  console.log("saved key :", DEFAULT_KEY.pathname)
}
console.log("RPC       :", RPC)
console.log("wallet    :", kp.publicKey.toBase58())

let bal = await connection.getBalance(kp.publicKey)
console.log("balance   :", bal / LAMPORTS_PER_SOL, "SOL")

if (bal < 0.3 * LAMPORTS_PER_SOL) {
  console.log("airdrop   : requesting 1 SOL (devnet)…")
  try {
    const s = await connection.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(s, "confirmed")
  } catch (e) {
    console.log("airdrop   : FAILED —", e.message)
  }
  bal = await connection.getBalance(kp.publicKey)
  console.log("balance   :", bal / LAMPORTS_PER_SOL, "SOL")
}

if (bal < 0.3 * LAMPORTS_PER_SOL) {
  console.log(
    "\n⚠ Insufficient devnet SOL. Fund this address then rerun:\n  " +
      kp.publicKey.toBase58() +
      "\n  faucet: https://faucet.solana.com  (or `solana airdrop 1 <addr> --url devnet`)"
  )
  process.exit(1)
}

const wallet = new anchor.Wallet(kp)
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
})
const program = new anchor.Program(idl, provider)
console.log("program   :", program.programId.toBase58())

// dev IDL: credit_to is a Solana pubkey — credit the depositor itself.
const creditTo = kp.publicKey
const lamports = new anchor.BN(0.25 * LAMPORTS_PER_SOL)

console.log("\ndeposit   : depositSol(0.25 SOL, {perp:{}}, credit_to)…")
try {
  const sig = await program.methods
    .depositSol(lamports, { perp: {} }, creditTo)
    .accounts({ depositor: kp.publicKey })
    .rpc()
  console.log("✅ SUCCESS")
  console.log("tx        :", sig)
  console.log("explorer  :", `https://explorer.solana.com/tx/${sig}?cluster=devnet`)
} catch (e) {
  console.log("❌ FAILED")
  console.log(e.message)
  if (e.logs) console.log("logs:\n" + e.logs.join("\n"))
  process.exit(1)
}
