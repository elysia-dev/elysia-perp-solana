"use client"

import { wagmiAdapter, projectId } from "@/lib/constants/wagmi"
import { solanaAdapter } from "@/lib/constants/solana"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createAppKit } from "@reown/appkit/react"
import { solanaDevnet } from "@reown/appkit/networks"
import React, { type ReactNode } from "react"
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi"

// Set up queryClient
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error && typeof error === "object" && "status" in error) {
          const status = (error as { status: number }).status
          // Don't retry on auth errors or rate limits
          if (status === 401 || status === 403 || status === 429) return false
        }
        return failureCount < 2
      },
    },
  },
})

// WalletConnect/AppKit dApp metadata — what the wallet shows on its approval
// screen and what WalletConnect Verify checks the connecting origin against.
//
// `url` MUST match the domain the app is actually served from: a mismatch
// (the old hardcoded "http://localhost:3000" boilerplate) makes Verify flag
// the site as unverified in wallets and can break mobile deep-link assembly.
// Same env pattern as the OG tags in app/layout.tsx — prod domain by
// default, other envs override with NEXT_PUBLIC_SITE_URL.
//
// `redirect.universal` is what sends the user BACK to the dApp after
// approving in a mobile wallet; without it the wallet keeps focus and the
// dApp tab is left backgrounded mid-connect (common "stuck connecting" on
// Android).
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://app.elysia.finance"

const metadata = {
  name: "Elysia Perp",
  description:
    "ZK-based Perpetual DEX — trade crypto and RWA perpetuals with EL collateral.",
  url: SITE_URL,
  // Wallets fetch icons over the network — must be an absolute URL.
  icons: [`${SITE_URL}/icons/logo/el_favi.svg`],
  redirect: {
    universal: SITE_URL,
  },
}

// Create the modal (side effect initializes AppKit). Network set mirrors
// `lib/constants/wagmi.ts#networks` so the AppKit picker and the wagmi
// adapter agree on which chains the user can connect to in this build.
createAppKit({
  // Solana hackathon build: the connect modal is Solana-only. The EVM (wagmi)
  // adapter and EVM networks are commented out below — restore them to bring
  // EVM wallets back into the modal.
  //
  // NOTE: WagmiProvider (and wagmiAdapter.wagmiConfig) is still mounted below
  // so the EVM-based trade/auth hooks keep compiling; they're just dormant
  // until auth is re-wired to Solana on the backend.
  adapters: [solanaAdapter /*, wagmiAdapter */],
  projectId,
  // Devnet only: the vault program is deployed on Solana devnet, so the wallet
  // connects there (aligns wallet balance/simulation with where deposits land).
  networks: [solanaDevnet /*, solana, ...networkConfig.appKitNetworks */],
  defaultNetwork: solanaDevnet,
  metadata: metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
})

function Web3Provider({
  children,
  cookies,
}: {
  children: ReactNode
  cookies: string | null
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies
  )

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

export default Web3Provider
