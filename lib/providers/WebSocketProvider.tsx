"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
} from "react"
import {
  apiClient,
  ApiError,
  refreshToken,
  setOnAuthRefreshed,
} from "@/lib/api/client"
import { useSystemHealthStore } from "@/lib/stores/useSystemHealthStore"

// `logged_in` is a non-HttpOnly cookie issued alongside access_token with the
// same 15-min TTL. If it's missing, the access_token is also gone, so we can
// avoid the inevitable 401 by refreshing first.
function hasFreshAccessToken(): boolean {
  if (typeof document === "undefined") return false
  return document.cookie.split("; ").some((c) => c.startsWith("logged_in="))
}

const WS_API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") ||
  "ws://localhost:3001"

type MessageHandler = (data: unknown) => void

interface WebSocketContextType {
  subscribe: (channel: string, handler: MessageHandler) => () => void
  isConnected: boolean
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]
const MAX_RECONNECT_ATTEMPTS = 10

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map())
  const subscribedChannelsRef = useRef<Set<string>>(new Set())
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const serverReadyRef = useRef(false)

  // Send subscribe for a single channel (matches server protocol: "channel" singular)
  const sendSubscribe = useCallback((channel: string, auth?: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN && serverReadyRef.current) {
      const msg: Record<string, string> = { type: "subscribe", channel }
      if (auth) msg.auth = auth
      ws.send(JSON.stringify(msg))
    }
  }, [])

  // Send unsubscribe for a single channel
  const sendUnsubscribe = useCallback((channel: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe", channel }))
    }
  }, [])

  // Re-subscribe all active channels (after reconnect).
  // Intentionally does NOT touch `tokenFailedRef`: the kill-switch is only
  // reset on a fresh WS handshake or an explicit user-visible "wake" event
  // (visibilitychange). Resetting it here used to race with concurrent
  // per-channel results — see the comment on `fetchTokenAndSubscribe`.
  const resubscribeAll = useCallback(() => {
    for (const channel of subscribedChannelsRef.current) {
      if (
        channel.startsWith("account_all/") ||
        channel.startsWith("account_all_orders/")
      ) {
        // private channels need auth — fetch token and subscribe
        fetchTokenAndSubscribe(channel)
      } else {
        sendSubscribe(channel)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendSubscribe])

  // Fetch JWT and subscribe to a private channel.
  // Uses apiClient so that an expired access_token triggers the shared
  // refresh-token flow (POST /api/auth/refresh) and retries once.
  // A shared in-flight promise dedupes concurrent ws-token requests so
  // multiple private channels mounting together only fire one HTTP call.
  const tokenFailedRef = useRef(false)
  const tokenPromiseRef = useRef<Promise<string> | null>(null)

  const getWsToken = useCallback((): Promise<string> => {
    if (tokenPromiseRef.current) return tokenPromiseRef.current
    tokenPromiseRef.current = (async () => {
      // Pre-refresh if the access_token cookie has clearly expired so we
      // don't have to round-trip through a guaranteed 401.
      if (!hasFreshAccessToken()) {
        await refreshToken()
      }
      const d = await apiClient<{ token: string }>("/ws-token", { auth: true })
      return d.token
    })().finally(() => {
      tokenPromiseRef.current = null
    })
    return tokenPromiseRef.current
  }, [])

  // Per-channel subscribe: fetches a JWT then sends a subscribe frame.
  //
  // The `tokenFailedRef` kill-switch is intentionally NOT cleared here on
  // success. Earlier the success path did `tokenFailedRef.current = false`,
  // which raced with concurrent failed siblings: if channel A succeeded a
  // beat after channel B failed with 401, A would overwrite B's flag and
  // we'd resume hammering /ws-token, producing the exact 401 storm the
  // kill-switch was meant to prevent. The flag is now cleared only at two
  // explicit recovery points: a fresh WS handshake (server says
  // "connected") and the user bringing the tab back to the foreground.
  // Both are monotonic, intentional, and free of cross-channel races.
  const fetchTokenAndSubscribe = useCallback(
    async (channel: string) => {
      if (tokenFailedRef.current) return // Skip if already failed (avoid 401 spam)
      try {
        const token = await getWsToken()
        sendSubscribe(channel, token)
      } catch (err) {
        // Only flip the kill-switch on auth failures so refresh can recover
        // transient network errors on the next reconnect.
        if (err instanceof ApiError && err.status === 401) {
          tokenFailedRef.current = true
        }
      }
    },
    [sendSubscribe, getWsToken]
  )

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return
    // `CLOSING` means the previous socket has been told to close but its
    // `onclose` hasn't fired yet. Spawning a new socket here would leak the
    // old one's keep-alive interval (it's tied to the variable captured in
    // *that* `onopen` closure, not to `wsRef.current`) — those pings would
    // keep firing against a dead handle every minute until tab unload.
    if (wsRef.current?.readyState === WebSocket.CLOSING) return
    if (!mountedRef.current) return

    // Defensive sweep: if a previous socket left its keep-alive timer
    // running (e.g. because `onclose` was never delivered before we got
    // here via a forced reconnect path), clear it now so the new socket's
    // `onopen` doesn't end up sharing the timer slot ambiguously.
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current)
      keepAliveRef.current = null
    }

    serverReadyRef.current = false
    const ws = new WebSocket(`${WS_API_URL}/api/v1/ws`)
    wsRef.current = ws

    // Zombie detection. A half-open connection (network path change, laptop
    // hotspot blip, NAT timeout) never delivers `onclose` — the socket looks
    // OPEN, our pings vanish into the void, and no channel ever streams
    // again. Without an inbound-traffic deadline the app silently loses ALL
    // realtime data until a manual reload (observed as the chart freezing at
    // a fixed candle while REST-backed panels kept moving). Every subscribed
    // client receives frames far more often than PONG_DEADLINE_MS (the
    // server answers pings at minimum), so a silent socket past the deadline
    // is dead with high confidence: force-close it — that fires `onclose`,
    // which runs the normal reconnect + resubscribeAll path.
    const PONG_DEADLINE_MS = 150_000
    let lastFrameAt = Date.now()

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close()
        return
      }
      reconnectAttemptRef.current = 0
      lastFrameAt = Date.now()

      // Keep-alive: send ping every 60s (server closes after 120s of no frames)
      if (keepAliveRef.current) clearInterval(keepAliveRef.current)
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (Date.now() - lastFrameAt > PONG_DEADLINE_MS) {
            // Silent past the deadline despite our pings → zombie. Close with
            // an APP-DEFINED code (4000-range), NOT the default 1000: the
            // onclose handler only schedules a reconnect for non-1000 codes,
            // and a zombie whose TCP path is still technically alive would
            // complete a default close() cleanly as 1000 — no reconnect, and
            // realtime stays dead for good. 4000 guarantees the reconnect
            // path runs. (On a truly dead path the handshake times out and
            // surfaces as 1006, which also reconnects — either way we heal.)
            console.warn("[WS] No frames for 150s — closing zombie socket")
            ws.close(4000, "zombie: no inbound frames past deadline")
            return
          }
          ws.send(JSON.stringify({ type: "ping" }))
        }
      }, 60_000)

      // Don't set isConnected yet — wait for "connected" message from server
    }

    ws.onmessage = (event) => {
      lastFrameAt = Date.now()
      // Parse separately so a malformed frame doesn't reach routing logic.
      // We deliberately keep this catch tight — earlier the entire routing
      // block was inside this try, which meant a single subscriber throwing
      // (e.g. a stale store still trying to read a freed ref) would abort
      // the for-loop, swallow the error in the catch, and silently drop
      // the message for every other channel.
      let parsed: unknown
      try {
        parsed = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (!parsed || typeof parsed !== "object") return
      const msg = parsed as {
        type?: unknown
        channel?: unknown
        [k: string]: unknown
      }

      // Wait for "connected" message before subscribing
      if (msg.type === "connected") {
        serverReadyRef.current = true
        setIsConnected(true)
        // A successful handshake is the strongest "backend is alive" signal
        // we have — recover from the unhealthy state if we were in it.
        useSystemHealthStore.getState().recordSuccess()
        // Fresh socket ⇒ fresh start. This is the canonical kill-switch
        // reset point; per-channel paths no longer touch it.
        tokenFailedRef.current = false
        // Re-subscribe to all active channels
        resubscribeAll()
        return
      }

      // Invoke a subscriber without letting its errors abort routing for
      // siblings. WS handlers come from many independent components
      // (positions list, balance pill, history tab…); one component's
      // stale closure or transient bug shouldn't blank the live data feed
      // for every other consumer of the same frame.
      const safeInvoke = (handler: MessageHandler) => {
        try {
          handler(msg)
        } catch (err) {
          console.error("[WS] Handler error:", err)
        }
      }

      // Route to channel-specific handlers. Only treat `channel` as a key
      // when it's actually a string — defends against malformed frames
      // (or hostile-shaped payloads) that could otherwise feed `Map.get`
      // with `Symbol.toPrimitive`-y objects.
      if (typeof msg.channel === "string") {
        handlersRef.current.get(msg.channel)?.forEach(safeInvoke)
      }

      // Route account_all updates to all account_all/* handlers
      if (msg.type === "update/account_all") {
        for (const [channel, handlers] of handlersRef.current) {
          if (channel.startsWith("account_all/")) {
            handlers.forEach(safeInvoke)
          }
        }
      }

      // Route account_all_orders updates to all account_all_orders/* handlers
      if (msg.type === "update/account_all_orders") {
        for (const [channel, handlers] of handlersRef.current) {
          if (channel.startsWith("account_all_orders/")) {
            handlers.forEach(safeInvoke)
          }
        }
      }
    }

    ws.onclose = (event) => {
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current)
        keepAliveRef.current = null
      }
      setIsConnected(false)
      serverReadyRef.current = false
      wsRef.current = null

      if (!mountedRef.current) return

      if (event.code !== 1000) {
        const attempt = reconnectAttemptRef.current
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          console.warn("[WS] Max reconnect attempts reached, stopping.")
          // Total WS failure means we can no longer trust the realtime layer.
          // Surface the full-page server-unavailable state so the user knows
          // not to trade against stale data.
          useSystemHealthStore.getState().setUnhealthy()
          return
        }
        const delay =
          RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)]
        reconnectAttemptRef.current = attempt + 1
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, delay)
      }
    }

    ws.onerror = (err) => {
      console.error("[WS] Error:", err)
    }
  }, [resubscribeAll])

  // Always connect on mount
  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [connect])

  // Drop the 401 kill-switch as soon as apiClient confirms auth recovered.
  // Closes the only remaining edge case from the resubscribeAll race fix:
  // /ws-token 401 → kill-switch set → some OTHER caller's apiClient call
  // refreshes the token → without this hook, the next private channel that
  // mounts is stuck behind a stale kill-switch until reconnect or wake.
  useEffect(() => {
    setOnAuthRefreshed(() => {
      tokenFailedRef.current = false
    })
    return () => setOnAuthRefreshed(null)
  }, [])

  // Re-subscribe on tab focus to get fresh snapshots. After a long sleep the
  // socket has usually died and reconnectAttemptRef may have hit the cap;
  // reset it and kick off a fresh connect so the page recovers instead of
  // sitting in the SystemHealthGuard error state forever.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return
      if (serverReadyRef.current) {
        // User returned to the tab — explicit "give it another shot" signal.
        // Safe to clear the kill-switch here even on a still-alive socket
        // because the user's intent is to resume normal operation, and any
        // auth that was the original cause is most likely refreshed by the
        // AuthProvider's wake handler that runs on the same event.
        tokenFailedRef.current = false
        resubscribeAll()
        return
      }
      reconnectAttemptRef.current = 0
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (
        !wsRef.current ||
        wsRef.current.readyState === WebSocket.CLOSED ||
        wsRef.current.readyState === WebSocket.CLOSING
      ) {
        connect()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility)
  }, [resubscribeAll, connect])

  // Auto-subscribe removed — channels are subscribed by their consumers:
  // - account_all/{index}: usePositions
  // - account_all_orders/{index}: useOpenPerpOrdersSync

  const subscribe = useCallback(
    (channel: string, handler: MessageHandler): (() => void) => {
      // Register handler
      if (!handlersRef.current.has(channel)) {
        handlersRef.current.set(channel, new Set())
      }
      handlersRef.current.get(channel)!.add(handler)

      // Subscribe on WS if not already
      if (!subscribedChannelsRef.current.has(channel)) {
        subscribedChannelsRef.current.add(channel)
        if (
          channel.startsWith("account_all/") ||
          channel.startsWith("account_all_orders/")
        ) {
          fetchTokenAndSubscribe(channel)
        } else {
          sendSubscribe(channel)
        }
      }

      // Return unsubscribe function
      return () => {
        const handlers = handlersRef.current.get(channel)
        if (handlers) {
          handlers.delete(handler)
          if (handlers.size === 0) {
            handlersRef.current.delete(channel)
            subscribedChannelsRef.current.delete(channel)
            sendUnsubscribe(channel)
          }
        }
      }
    },
    [sendSubscribe, sendUnsubscribe, fetchTokenAndSubscribe]
  )

  return (
    <WebSocketContext.Provider value={{ subscribe, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error("useWebSocket must be used within WebSocketProvider")
  }
  return context
}
