"use client"

import { useState, useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  useAppKitAccount,
  useAppKitProvider,
  useDisconnect,
} from "@reown/appkit/react"
import type { Provider } from "@reown/appkit-adapter-solana/react"
import bs58 from "bs58"
import { apiClient, serverNow } from "@/lib/api/client"
import {
  useAuthContext,
  clearUserScopedQueries,
} from "@/lib/providers/AuthProvider"
import { trackWalletLogin } from "@/lib/analytics/ga"
import type { LoginRequest, LoginResponse } from "@/types"

// Check if error is user rejection (cancelled signature)
function isUserRejection(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("rejected") ||
      message.includes("denied") ||
      message.includes("cancelled") ||
      message.includes("user refused")
    )
  }
  return false
}

const API_URL = "/api" // Proxied through Next.js rewrites

// Module-level lock so only ONE login (= one signature request) runs at a
// time, no matter how many callers fire `login()` at once. The header
// triggers login from three independent effects — fresh wallet connect,
// "auth lost while connected" re-login, and account-switch re-login — and
// React StrictMode double-invokes effects in dev, so a single login could
// otherwise fan out into 3–4 simultaneous wallet signature prompts. Beyond
// the obvious UX problem, those prompts also race the server's single-use
// replay guard ((recovered address, timestamp) dedup), so all but one settle
// as `MESSAGE_REPLAYED`, leaving the session half-set and the UI stuck
// logged-out. The lock collapses the burst to one prompt; it's
// released on settle so a genuinely-needed later login (e.g. after an
// account switch completes) can still proceed.
let loginInFlight = false

export function useAuth() {
  // Solana hackathon build: identity + signing come from the connected Solana
  // wallet via Reown AppKit (the EVM/wagmi path is disabled in Web3Provider).
  const account = useAppKitAccount({ namespace: "solana" })
  const address = account.address
  const isConnected = account.isConnected
  const { walletProvider } = useAppKitProvider<Provider>("solana")
  const { disconnect } = useDisconnect()
  const queryClient = useQueryClient()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const {
    isAuthenticated,
    setAuthenticated,
    clearAuth,
    accountSwitched,
    clearAccountSwitched,
    isRefreshing,
    isAuthReady,
  } = useAuthContext()

  const loginMutation = useMutation({
    mutationFn: async () => {
      if (!address) {
        throw new Error("Wallet not connected")
      }

      // 1. Generate a fresh timestamp (ms). This doubles as the single-use
      // nonce — there is no `GET /nonce` round-trip anymore. The server
      // enforces a 60s-past / 5s-future freshness window and rejects re-use
      // of the same (recovered address, timestamp) pair with
      // `MESSAGE_REPLAYED`, so every attempt must carry a fresh timestamp +
      // signature.
      //
      // SERVER-aligned, not raw `Date.now()`: a client clock even ~5s fast
      // blows the future-skew window and every login 401s with "timestamp
      // invalid" (which also strands the wallet-switch flow mid-transition —
      // the old account's orders stay on screen because the new account
      // never finishes logging in). `serverNow()` corrects with the offset
      // sampled from response `Date` headers; the extra 1s backdate absorbs
      // the header's second-level rounding — harmless against the 60s past
      // window.
      const timestamp = serverNow() - 1_000

      // 2. Build the byte-EXACT Solana login message. The server rebuilds this
      // itself (double newlines included) and never accepts one from the
      // client — any drift → "Invalid Solana signature". Format per
      // solana/docs/frontend-integration.md.
      const message =
        `Access Elysia Perp account.\n\n` +
        `Solana address: ${address}\n\n` +
        `Timestamp: ${timestamp}`

      // 3. Sign with the Solana wallet (ed25519 signMessage over raw UTF-8
      // bytes). Returns a Uint8Array; base58-encode it.
      if (!walletProvider) {
        throw new Error("Solana wallet not available")
      }
      const sigBytes = await walletProvider.signMessage(
        new TextEncoder().encode(message)
      )
      const signature = bs58.encode(sigBytes)

      // 4. Send to the Solana login endpoint. ed25519 has no signer recovery,
      // so the Solana pubkey travels in `address` for the server to verify
      // against. An unknown wallet creates an account (no separate signup).
      const loginRequest: LoginRequest = {
        signature,
        timestamp,
        address,
      }

      const response = await apiClient<LoginResponse>("/auth/solana/login", {
        method: "POST",
        body: loginRequest,
        auth: true, // Include credentials so server can set cookies
      })

      // 5. Purge any user-scoped cache BEFORE flipping auth on. Defense in
      // depth for wallet switches: if any race repopulated the cache with the
      // previous wallet's data (e.g. `["account"]` → old accountIndex → old
      // open orders), its 5-min staleTime would keep serving it to the NEW
      // session. Removing here guarantees every user-scoped query refetches
      // under the new cookies the moment `enabled` flips true. For a plain
      // fresh login the cache is empty and this is a no-op.
      clearUserScopedQueries(queryClient)

      // 6. Update auth state (cookies already set by server)
      setAuthenticated(true)

      // 7. Analytics: record the wallet login (no-op off prod / without a GA id)
      trackWalletLogin(address)

      return response
    },
    onError: (error) => {
      console.error("[useAuth] Login error:", error)

      if (isUserRejection(error)) {
        console.error(
          "[useAuth] User rejected signature - disconnecting wallet"
        )
        void disconnect()
        setShowAuthModal(true)
      }
    },
  })

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Call logout endpoint to clear cookies
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
      clearAuth()
    },
    onError: (error) => {
      console.error("[useAuth] Logout error:", error)
    },
  })

  // Concurrency-guarded login: drops calls that arrive while a login (and
  // therefore a signature prompt) is already in flight, then releases the
  // lock once it settles. See `loginInFlight` above for why this matters.
  //
  // IMPORTANT: depend on the stable `mutate` reference, NOT the whole
  // `loginMutation` object. `useMutation` returns a fresh object every
  // render, so depending on it would make `login` change identity each
  // render — and the Header's login effect lists `login` in its deps, so it
  // would re-run every render, reset its `hasAttemptedLogin` guard, and fire
  // `login()` again… an endless stream of signature prompts. `mutate` is
  // referentially stable across renders, so the callback stays stable.
  const loginMutate = loginMutation.mutate
  const login = useCallback(() => {
    if (loginInFlight) return
    loginInFlight = true
    loginMutate(undefined, {
      onSettled: () => {
        loginInFlight = false
      },
    })
  }, [loginMutate])

  return {
    // State
    isConnected,
    isAuthenticated,
    address,
    accountSwitched,
    isRefreshing,
    isAuthReady,
    showAuthModal,

    // Actions
    login,
    loginAsync: loginMutation.mutateAsync,
    signOut: logoutMutation.mutate,
    signOutAsync: logoutMutation.mutateAsync,
    clearAccountSwitched,
    setShowAuthModal,

    // Mutation state
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    isLoggingOut: logoutMutation.isPending,
  }
}
