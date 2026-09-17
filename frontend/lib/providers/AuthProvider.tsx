"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react"
import { useAppKitAccount } from "@reown/appkit/react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { isLoggedInCookiePresent } from "@/lib/utils/cookie"
import { refreshToken, setOnAuthFailure } from "@/lib/api/client"

const API_URL = "/api" // Proxied through Next.js rewrites

// Clear ONLY the user-scoped queries on logout / account switch.
//
// `queryClient.clear()` nukes the entire cache including public market data
// (`markets`, `orderBookDetails`, `chartData`, `markPrices`, `trades`,
// `orderbook-rest`). Doing that triggers a "flicker" the user sees on
// disconnect: every consumer of those public queries re-renders with
// `data: undefined / isLoading: true`, the screen drops to empty/loading
// affordances for ~200–800 ms while the public REST endpoints get re-hit,
// and then everything refills. None of those queries depend on the
// auth cookie — they were correctly populated before logout and the same
// rows would be re-fetched immediately after — so wiping them just
// introduces a visual glitch with zero security benefit.
//
// Public market data is also displayed to anonymous users (the chart,
// orderbook, market list all render before login), so there's no privacy
// reason to evict it either.
//
// We only remove queries that contain user-scoped data, leaving public
// queries intact. Listed exhaustively to avoid relying on prefix matches
// that could silently miss a new query introduced later.
const USER_SCOPED_QUERY_KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ["account"],
  ["perpOrders", "open"],
  ["perpOrders", "history"],
  ["perp-trades"],
  ["deposit-history"],
  ["withdrawal-history"],
  ["fundingHistory"],
]

export function clearUserScopedQueries(qc: QueryClient) {
  for (const key of USER_SCOPED_QUERY_KEYS) {
    qc.removeQueries({ queryKey: key })
  }
}

interface AuthContextType {
  isAuthenticated: boolean
  setAuthenticated: (value: boolean) => void
  clearAuth: () => void
  accountSwitched: boolean
  clearAccountSwitched: () => void
  isRefreshing: boolean
  isAuthReady: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Solana hackathon build: auth follows the connected Solana wallet (Reown
  // AppKit), not the disabled EVM/wagmi adapter. `status` is derived from
  // `isConnected` so the disconnect/auto-logout effects below behave the same.
  const { isConnected, address } = useAppKitAccount({ namespace: "solana" })
  const status: "connected" | "disconnected" = isConnected
    ? "connected"
    : "disconnected"
  const queryClient = useQueryClient()
  // Always start with false to avoid hydration mismatch
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [accountSwitched, setAccountSwitched] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const wasConnected = useRef(isConnected)
  const prevAddress = useRef(address)
  const hasAttemptedRefresh = useRef(false)
  // True from the moment an account switch is DETECTED (synchronously, in the
  // address-change effect below) until its logout round-trip settles. The
  // `accountSwitched` STATE only flips true after the logout fetch resolves,
  // which leaves a window where the reconcile effect sees
  // `isAuthenticated=false`, `accountSwitched=false`, and a still-valid
  // `logged_in` cookie (the server hasn't cleared it yet) — and "heals" auth
  // back to true on the OLD wallet's session. That resurrected session
  // refetches the old account/orders, which then stick around after the new
  // wallet logs in. A ref (not state) because it must be visible to the
  // reconcile effect in the very next commit, with no scheduling delay.
  const switchInProgress = useRef(false)

  // Sync with cookie on mount (after hydration)
  useEffect(() => {
    const loggedIn = isLoggedInCookiePresent()
    setIsAuthenticated(loggedIn)
    setIsAuthReady(true)
  }, [])

  // Run a refresh attempt when we *should* be authenticated but the
  // logged_in cookie is gone. The cookie — not React state — is the source
  // of truth: state can be stale after wake-from-sleep (cookie expired
  // while React still thinks we're logged in).
  //
  // Note: `isAuthenticated` deliberately is NOT in the guard. Putting it
  // there would cause a stale-closure deadlock when the tab wakes up —
  // React state still says true, so refresh would never fire and the user
  // would land on a 401 wall.
  const tryRefresh = useCallback(() => {
    if (!isAuthReady) return
    if (isLoggedInCookiePresent()) return
    if (hasAttemptedRefresh.current) return
    if (!isConnected || isRefreshing) return

    hasAttemptedRefresh.current = true
    setIsRefreshing(true)

    // Use the apiClient's shared `refreshToken()` so any concurrent caller
    // (this hook re-firing, the apiClient retrying a 401, another tab waking
    // up, etc.) awaits the SAME network request. Without this dedup, a
    // single wake event can fan out into N parallel POSTs to /auth/refresh;
    // the backend rotates refresh_tokens per-call and treats the older
    // tokens being "reused" as a security violation, invalidating ALL
    // sessions and forcing a full re-login.
    refreshToken()
      .then((result) => {
        if (result.success) setIsAuthenticated(true)
      })
      .finally(() => {
        setIsRefreshing(false)
      })
  }, [isConnected, isRefreshing, isAuthReady])

  useEffect(() => {
    tryRefresh()
  }, [tryRefresh])

  // Wake from sleep / tab return: the access_token + logged_in cookies
  // (15-min TTL) are usually expired by now. We also flip
  // setIsAuthenticated(false) so the rest of the app (Header, query gates,
  // etc.) reflects the real auth state immediately instead of firing more
  // 401s against stale state.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      if (isLoggedInCookiePresent()) return
      hasAttemptedRefresh.current = false
      setIsAuthenticated(false)
      tryRefresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [tryRefresh])

  // Catch-all reconcile: keep React auth state in sync with the `logged_in`
  // cookie, which IS the source of truth (see the mount sync and `tryRefresh`).
  //
  // Confirmed failure mode: the app ends up with `isAuthenticated === false`
  // while the cookie says `logged_in=true` and `/account` returns 200. The
  // user sees a logged-out UI (Deposit disabled, `Avbl` "-", "You need to
  // authenticate") even though the session is perfectly valid, and only a
  // full page reload fixes it (because the mount effect re-reads the cookie).
  // Several paths can flip state to `false` without clearing the cookie — the
  // global 401 handler on a transient/raced 401, a brief wagmi reconnect
  // flicker, login bursts racing the single-use replay guard — and once that happens
  // nothing restores it, because `tryRefresh` deliberately no-ops while the
  // cookie is present.
  //
  // This effect closes the gap for ALL of those triggers at once: whenever
  // state reads `false` but the cookie is still valid, restore `true`. It
  // runs reactively the instant `isAuthenticated` drops, so the desync never
  // becomes user-visible. Guards prevent fighting a legitimate teardown:
  //   • `!isConnected`   → a disconnect/logout is in progress.
  //   • `accountSwitched`→ an account switch is mid-flight; the switch logout
  //                        clears the cookie and the re-login flow owns recovery.
  // A genuinely expired session also clears the `logged_in` cookie (its TTL
  // matches the access token), so this only heals the state/cookie desync —
  // it never resurrects a dead session.
  useEffect(() => {
    if (!isAuthReady) return
    if (isAuthenticated) return
    if (!isConnected) return
    if (accountSwitched) return
    // Account switch detected but its logout hasn't settled yet — the old
    // session's cookie is still present, so healing here would resurrect the
    // OLD wallet's session (and its orders). See `switchInProgress` decl.
    if (switchInProgress.current) return
    if (isLoggedInCookiePresent()) {
      setIsAuthenticated(true)
    }
  }, [isAuthenticated, isConnected, accountSwitched, isAuthReady])

  // Auto logout on wallet disconnect — but ONLY for real, intentional disconnects.
  //
  // Wagmi's `isConnected` flickers `true → false → true` in several routine
  // situations:
  //   • SSR / hydration: starts `false`, becomes `true` after wagmi mounts
  //   • Wake-from-sleep: provider re-initialises on tab return
  //   • Network/chain switch: the connector briefly drops while reconnecting
  //   • Wallet popup focus changes (some injected wallets)
  //
  // The previous version reacted to the first `true → false` edge it saw,
  // which meant a transient flicker would call `/auth/logout`, clear the
  // React Query cache, and leave the user staring at a blank app even
  // though their session was perfectly valid. Two guards prevent that:
  //
  //   1. `isAuthReady` — don't act before the initial cookie-sync runs;
  //      otherwise we treat hydration `false` as a "disconnect".
  //   2. `status === "disconnected"` + a short debounce window — wagmi
  //      reports `"reconnecting"` (or `"connecting"`) during transient
  //      flickers, so we only treat a `"disconnected"` status as real
  //      AND require it to persist past the stabilisation window. If the
  //      wallet comes back inside the window the timeout is cancelled by
  //      the effect cleanup.
  useEffect(() => {
    if (!isAuthReady) return

    const isRealDisconnect =
      wasConnected.current &&
      !isConnected &&
      status === "disconnected" &&
      isAuthenticated

    if (isRealDisconnect) {
      const stabilizeId = setTimeout(() => {
        // Reached the end of the stabilisation window without wagmi
        // reconnecting — treat as a genuine logout.
        fetch(`${API_URL}/auth/logout`, {
          method: "POST",
          credentials: "include",
        }).catch((err) => console.error("[AuthProvider] Logout error:", err))
        setIsAuthenticated(false)
        hasAttemptedRefresh.current = false
        wasConnected.current = false
        clearUserScopedQueries(queryClient)
      }, 800)
      return () => clearTimeout(stabilizeId)
    }

    wasConnected.current = isConnected
  }, [isConnected, isAuthenticated, isAuthReady, status, queryClient])

  // Auto logout on account switch - call server to clear cookies then trigger re-login
  useEffect(() => {
    const addressChanged =
      prevAddress.current && address && prevAddress.current !== address

    if (addressChanged && isAuthenticated) {
      // Block the reconcile effect SYNCHRONOUSLY, before the logout
      // round-trip. `setAccountSwitched(true)` only lands after the fetch
      // resolves; without this ref the reconcile effect wins the race and
      // restores the old wallet's session from its still-valid cookie.
      switchInProgress.current = true

      // Call logout API to clear server cookies for previous account
      fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
        .then(() => {
          // Signal that account was switched so Header can trigger re-login
          setAccountSwitched(true)
        })
        .catch((err) => console.error("[AuthProvider] Logout error:", err))
        .finally(() => {
          // Safe to release either way: on success `accountSwitched` (state)
          // now guards the reconcile effect; on failure the old session is
          // still live server-side and healing back into it is the
          // pre-existing (harmless) behaviour.
          switchInProgress.current = false
        })

      setIsAuthenticated(false)
      hasAttemptedRefresh.current = false
      clearUserScopedQueries(queryClient)
    }

    // Only remember the address when it's actually a real one. wagmi
    // briefly emits `undefined` during network/chain switches and during
    // wallet provider re-hydration; clobbering `prevAddress.current` with
    // those transient nulls would make the *next* real address arrival
    // look like a first load (no previous to compare against) and miss
    // the genuine account-switch logout.
    if (address) {
      prevAddress.current = address
    }
  }, [address, isAuthenticated, queryClient])

  const setAuthenticated = useCallback((value: boolean) => {
    setIsAuthenticated(value)
  }, [])

  const clearAuth = useCallback(() => {
    setIsAuthenticated(false)
    hasAttemptedRefresh.current = false
    clearUserScopedQueries(queryClient)
  }, [queryClient])

  // Register global 401 handler — triggers re-login flow when refresh fails.
  //
  // IMPORTANT: do NOT clear `hasAttemptedRefresh.current` here. We just
  // *finished* trying and the backend told us the refresh_token is dead.
  // Re-arming the flag turns this callback into a refresh-storm trigger:
  //   tryRefresh → 401 → onAuthFailure → re-arm → effect deps change →
  //   tryRefresh runs again → 401 → … (one request per polling hook per tick).
  //
  // The visibility-wake handler is the canonical place to re-arm the flag,
  // and it already does so the next time the tab actually returns to focus
  // (e.g. user reconnects wallet → fresh cookies → cookie present → refresh
  // unnecessary, or cookies still gone → re-armed and retried once).
  useEffect(() => {
    setOnAuthFailure(() => {
      // The cookie — not React state — is the source of truth. A 401 that
      // fires while the `logged_in` cookie is still valid is almost always
      // transient/raced: an authed query that went out a beat before the
      // freshly-set login cookie was attached, or a brief backend blip. In
      // that case tearing down auth state STRANDS the UI: `tryRefresh`
      // early-returns because the cookie IS present, so nothing flips state
      // back to `true`, and the user sees a logged-out app (Deposit disabled,
      // `Avbl` showing "-") until they manually reload. apiClient's own
      // refresh already handles recovery, so we leave state intact here and
      // only flip to logged-out on a *real* session loss — which, by the
      // 15-min `logged_in` TTL matching the access token, means the cookie is
      // already gone.
      if (isLoggedInCookiePresent()) return
      setIsAuthenticated(false)
    })
    return () => setOnAuthFailure(null)
  }, [])

  const clearAccountSwitched = useCallback(() => {
    setAccountSwitched(false)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        setAuthenticated,
        clearAuth,
        accountSwitched,
        clearAccountSwitched,
        isRefreshing,
        isAuthReady,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider")
  }
  return context
}
