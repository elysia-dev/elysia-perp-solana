import { useSystemHealthStore } from "@/lib/stores/useSystemHealthStore"

const API_URL = "/api" // Proxied through Next.js rewrites

// ---- Server clock offset ----
// The backend rejects login signatures whose timestamp sits more than 5s
// AHEAD of the server clock (EIP-191 future-skew guard, `eip191.rs`). User
// PC clocks are routinely seconds fast, so signing with raw `Date.now()`
// makes login fail intermittently with 401 "timestamp invalid" — which also
// strands the wallet-switch flow (old account's orders stay on screen
// because the new account never finishes logging in).
//
// Every HTTP response already carries a server-stamped `Date` header
// (backend/proxy are NTP-synced, unlike user machines), so we sample it on
// each apiClient response and expose a server-aligned clock. No extra
// round-trip. Precision is ~±1s (Date header has second granularity) and
// both error sources (truncation, network latency) bias the estimate into
// the PAST — the safe direction, since the past-validity window is 60s
// while the future window is only 5s.
let serverTimeOffsetMs: number | null = null

function sampleServerTime(response: Response) {
  const dateHeader = response.headers.get("date")
  if (!dateHeader) return
  const serverMs = Date.parse(dateHeader)
  if (Number.isNaN(serverMs)) return
  serverTimeOffsetMs = serverMs - Date.now()
}

// Server-aligned "now" (ms). Falls back to the local clock until the first
// response is sampled — in practice the public market queries fire well
// before any login, so the offset is populated by the time a signature is
// requested.
export function serverNow(): number {
  return Date.now() + (serverTimeOffsetMs ?? 0)
}

// Auth endpoints have their own retry semantics (refresh flow). Health
// counter should only react to "real" backend availability signals, so we
// don't let an expired refresh_token flip the whole app into error state.
function shouldTrackHealth(endpoint: string) {
  return !endpoint.startsWith("/auth/")
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  auth?: boolean // Include credentials for authenticated endpoints
  // Override the base path for THIS request only (e.g. the faucet lives on a
  // separate API server proxied at "/api-server"). The auth-refresh call always
  // stays on the main "/api" — the session cookie is shared across both.
  basePath?: string
}

// Shared refresh promise - all 401 requests wait on the same promise
let refreshPromise: Promise<RefreshResult> | null = null

// Settled-success cache — backstop for the microtask-scale window between
// `refreshPromise` being nulled (in finally) and the original awaiters'
// `.then` continuations actually running. A caller arriving in that window
// would otherwise see `refreshPromise === null` and start a *fresh*
// /auth/refresh round-trip, even though the cookie is already populated
// with the result we just got a millisecond ago. Under a 401 burst (e.g.
// reconnect storm with many concurrent queries) this cascades into N+1
// refresh calls instead of 1, each rotating the refresh_token and putting
// the backend's reuse detector at risk. 5s is comfortably longer than any
// .then microtask continuation and short enough that legit re-auth needs
// later in the session aren't masked.
let lastSuccessfulRefreshAt = 0
const REFRESH_SUCCESS_CACHE_MS = 5_000

interface RefreshResult {
  success: boolean
  error?: string
  code?: string
}

// Global auth failure callback — set by AuthProvider
let onAuthFailure: (() => void) | null = null

export function setOnAuthFailure(callback: (() => void) | null) {
  onAuthFailure = callback
}

// Global "refresh succeeded" callback — set by WebSocketProvider so it can
// drop its cached 401 kill-switch when auth has clearly recovered. This is
// the only piece of cross-layer signalling we need: without it, a /ws-token
// 401 leaves the WS provider in a "give up" state until the next reconnect
// or visibility wake — even though apiClient may have already restored the
// session for a different caller seconds later.
let onAuthRefreshed: (() => void) | null = null

export function setOnAuthRefreshed(callback: (() => void) | null) {
  onAuthRefreshed = callback
}

export function refreshToken(): Promise<RefreshResult> {
  // Primary dedup: an in-flight refresh is shared by everyone who arrives
  // while it's running.
  if (refreshPromise) {
    return refreshPromise
  }

  // Secondary dedup: a refresh that just succeeded a heartbeat ago is still
  // "fresh enough" — return success without another round-trip. This closes
  // the gap between `refreshPromise = null` (in finally) and the awaiters'
  // .then callbacks; only failures bypass the cache so genuine retry needs
  // aren't suppressed.
  if (Date.now() - lastSuccessfulRefreshAt < REFRESH_SUCCESS_CACHE_MS) {
    return Promise.resolve({ success: true })
  }

  // Start new refresh - all concurrent 401s will share this promise
  refreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      })

      if (response.ok) {
        lastSuccessfulRefreshAt = Date.now()
        // Notify anyone holding a cached "auth is broken" verdict that the
        // session is alive again. Fire-and-forget; listeners must not throw.
        try {
          onAuthRefreshed?.()
        } catch {
          // Swallow listener errors — refresh result must not depend on them.
        }
        return { success: true }
      }

      // Parse error response
      const errorBody = await response.json().catch(() => ({}))
      return {
        success: false,
        error: errorBody.error || "Token refresh failed",
        code: errorBody.code || "REFRESH_FAILED",
      }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error during refresh",
        code: "NETWORK_ERROR",
      }
    } finally {
      // Release the inflight slot. The settled-success cache above keeps
      // back-to-back callers off the network for the next few seconds.
      refreshPromise = null
    }
  })()

  return refreshPromise
}

// True if the response indicates a missing/expired auth cookie. The backend
// may return HTTP 401, or 200 (or other) with a body shaped
// `{ code: "MISSING_AUTH_COOKIE", error: ... }`. We clone before reading so
// the original response body remains intact for downstream consumers.
async function isAuthMissing(response: Response): Promise<boolean> {
  if (response.status === 401) return true
  try {
    const body = (await response.clone().json()) as { code?: string }
    return body?.code === "MISSING_AUTH_COOKIE"
  } catch {
    return false
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, auth = false, basePath = API_URL } = options

  const config: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    // Disable browser caching for fresh data on each request
    cache: "no-store",
    // Only include credentials for authenticated endpoints
    ...(auth && { credentials: "include" as RequestCredentials }),
  }

  if (body) {
    config.body = JSON.stringify(body)
  }

  const trackHealth = shouldTrackHealth(endpoint)

  let response: Response
  try {
    response = await fetch(`${basePath}${endpoint}`, config)
  } catch (err) {
    // Network error — treat as a backend availability failure
    if (trackHealth) useSystemHealthStore.getState().recordFailure()
    throw err
  }

  // Handle missing/expired auth with auto-refresh.
  // Backend may signal this as either an HTTP 401 OR a non-401 response whose
  // body carries `code: "MISSING_AUTH_COOKIE"`. Both must trigger refresh+retry,
  // otherwise the caller sees a silent failure (e.g. a Market order toast that
  // reads "Failed" with no recovery).
  const isAuthEndpoint = endpoint.startsWith("/auth/")
  if (auth && !isAuthEndpoint && (await isAuthMissing(response))) {
    const refreshResult = await refreshToken()

    if (refreshResult.success) {
      // Retry original request
      try {
        response = await fetch(`${basePath}${endpoint}`, config)
      } catch (err) {
        if (trackHealth) useSystemHealthStore.getState().recordFailure()
        throw err
      }
      // If the retry STILL signals missing auth, the refresh didn't actually
      // restore the session — surface that to the caller as an auth error
      // (instead of letting the auth-error body fall through as success).
      if (await isAuthMissing(response)) {
        // Auth is genuinely broken right now → the "recently succeeded"
        // verdict is stale and must not be allowed to mask the next call.
        lastSuccessfulRefreshAt = 0
        onAuthFailure?.()
        throw new ApiError(
          401,
          "Authentication missing after refresh",
          "MISSING_AUTH_COOKIE"
        )
      }
    } else {
      // Refresh failed — notify app to re-login
      lastSuccessfulRefreshAt = 0
      onAuthFailure?.()
      throw new ApiError(401, refreshResult.error!, refreshResult.code)
    }
  }

  // Keep the server-clock offset fresh from whatever response we ended up
  // with (original or post-refresh retry) — status doesn't matter, the Date
  // header is stamped server-side either way.
  sampleServerTime(response)

  // Only 5xx/network failures should escalate to "server down". 4xx is a
  // client/business error and shouldn't blank the page.
  if (trackHealth) {
    if (response.status >= 500) {
      useSystemHealthStore.getState().recordFailure()
    } else if (response.ok) {
      useSystemHealthStore.getState().recordSuccess()
    }
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      errorBody.error || response.statusText,
      // Auth errors carry `code`; market-mode rejections (ELP-499) carry
      // `reason` ("MARKET_HALTED" | "MARKET_REDUCE_ONLY"). Fold both into
      // ApiError.code so callers have ONE stable field to branch on.
      errorBody.code || errorBody.reason
    )
  }

  return response.json()
}

// Custom error class for API errors
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// Helper to check if error requires re-login
export function isAuthError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return (
    error.status === 401 ||
    error.code === "REFRESH_FAILED" ||
    error.code === "NETWORK_ERROR"
  )
}
