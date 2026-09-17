"use client"

import { solanaAdapter } from "@/lib/constants/solana"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createAppKit } from "@reown/appkit/react"
import { SOLANA_NETWORK } from "@/lib/solana/network"
import { type ReactNode } from "react"

// Reown/WalletConnect project id. Public client identifier (NOT a secret), so
// it ships in the bundle either way — env-driven only to allow a different
// project per environment. Falls back to the shared default when unset.
const projectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "4904537e8592e7bd77c13800298adf15"

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

// Create the modal (side effect initializes AppKit). Solana-only: the connect
// modal offers Solana wallets. Cluster is env-driven (NEXT_PUBLIC_NETWORK):
// production → mainnet-beta, otherwise devnet — see lib/solana/network.ts.
createAppKit({
  adapters: [solanaAdapter],
  projectId,
  networks: [SOLANA_NETWORK],
  defaultNetwork: SOLANA_NETWORK,
  metadata: metadata,
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
})

function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export default Web3Provider
