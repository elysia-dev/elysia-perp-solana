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
import { MEME_MINT, DEVNET_RPC, getAssociatedTokenAddress } from "./meme"

/** Connected wallet's devnet MEME balance (ui amount), or 0 when the wallet
 *  holds none / has no token account yet. */
export function useSolBalance() {
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" })
  return useQuery({
    queryKey: ["spyder-balance", address],
    enabled: isConnected && !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const connection = new web3.Connection(DEVNET_RPC, "confirmed")
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
