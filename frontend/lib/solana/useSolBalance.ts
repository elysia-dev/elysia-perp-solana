"use client"

// Connected wallet's MEME token balance on Solana devnet (the depositable
// SPL token for market 129). Read from the wallet's associated token account;
// polls so the header pill tracks deposits/mints without a manual refresh.
//
// (Hook name kept as `useSolBalance` to limit churn; it now reads the MEME
// SPL token balance, not native SOL.)

import { useQuery } from "@tanstack/react-query"
import { web3 } from "@coral-xyz/anchor"
import { useAppKitAccount } from "@reown/appkit/react"
import { MEME_MINT, getAssociatedTokenAddress } from "./meme"
import { SOLANA_RPC } from "./network"

/** Connected wallet's devnet MEME balance (ui amount), or 0 when the wallet
 *  holds none / has no token account yet. */
export function useSolBalance() {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" })
  return useQuery({
    queryKey: ["spyder-balance", address],
    enabled: isConnected && !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const connection = new web3.Connection(SOLANA_RPC, "confirmed")
      const ata = getAssociatedTokenAddress(
        MEME_MINT,
        new web3.PublicKey(address!)
      )
      try {
        const res = await connection.getTokenAccountBalance(ata)
        return res.value.uiAmount ?? 0
      } catch {
        // No associated token account yet → zero balance.
        return 0
      }
    },
  })
}

/** Connected wallet's native SOL balance (in SOL). Used to gate actions that
 *  need the user to cover fees / token-account rent (e.g. the faucet claim). */
export function useSolNativeBalance() {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" })
  return useQuery({
    queryKey: ["sol-native-balance", address],
    enabled: isConnected && !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const connection = new web3.Connection(SOLANA_RPC, "confirmed")
      try {
        const lamports = await connection.getBalance(new web3.PublicKey(address!))
        return lamports / web3.LAMPORTS_PER_SOL
      } catch {
        return 0
      }
    },
  })
}
