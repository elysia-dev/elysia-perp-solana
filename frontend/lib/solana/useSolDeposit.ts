"use client"

// MEME deposit into the Elysia vault program on Solana devnet. MEME is the
// SPL quote token for market 129 (SPY-PERP-MEME); a deposit credits asset
// 9004 at 1:1 (6 decimals, $1 peg). Fully on-chain — needs no Elysia backend
// for the transfer. See lib/solana/meme.ts and the dev vault program.
//
// (Hook name kept as `useSolDeposit` to limit churn; it now deposits the SPL
// MEME token via the `deposit` instruction, not native SOL.)

import { useCallback } from "react"
import { AnchorProvider, Program, BN, web3, type Idl } from "@coral-xyz/anchor"
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react"
import type { Provider as SolanaWalletProvider } from "@reown/appkit-adapter-solana/react"
import idl from "./idl/elysia_perp.json"
import {
  MEME_MINT,
  MEME_DECIMALS,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "./meme"
import { SOLANA_RPC } from "./network"

const { Connection } = web3

export function useSolDeposit() {
  const { walletProvider } = useAppKitProvider<SolanaWalletProvider>("solana")
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" })

  const deposit = useCallback(
    async (uiAmount: number): Promise<string> => {
      const publicKey = walletProvider?.publicKey
      if (!walletProvider || !publicKey) {
        throw new Error("Solana wallet not connected")
      }
      if (!(uiAmount > 0)) {
        throw new Error("Amount must be greater than 0")
      }

      const connection = new Connection(SOLANA_RPC, "confirmed")
      const wallet = {
        publicKey,
        signTransaction: walletProvider.signTransaction.bind(walletProvider),
        signAllTransactions:
          walletProvider.signAllTransactions?.bind(walletProvider) ??
          (<T>(txs: T[]) =>
            Promise.all(
              txs.map((t) => walletProvider.signTransaction(t as never))
            ) as Promise<T[]>),
      }
      const provider = new AnchorProvider(
        connection,
        wallet as unknown as AnchorProvider["wallet"],
        { commitment: "confirmed" }
      )
      const program = new Program(idl as Idl, provider)

      // 6-decimal base units; rate is 1/1 so this is also the credited amount.
      const amount = new BN(Math.round(uiAmount * 10 ** MEME_DECIMALS))
      const depositorTokenAccount = getAssociatedTokenAddress(
        MEME_MINT,
        publicKey
      )

      // credit_to is a Solana pubkey (dev IDL) — the connected wallet. Anchor
      // resolves config/token_config/vault/event_authority/program PDAs; only
      // mint, the depositor's ATA, depositor and the token program are passed.
      const sig = await program.methods
        .deposit(amount, { perp: {} }, publicKey)
        .accounts({
          mint: MEME_MINT,
          depositorTokenAccount,
          depositor: publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      return sig
    },
    [walletProvider]
  )

  return { deposit, address, isConnected }
}
