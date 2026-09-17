"use client"

import { useEffect, useCallback, useSyncExternalStore } from "react"
import { useWebSocket } from "@/lib/providers/WebSocketProvider"
import { apiClient } from "@/lib/api/client"
import type { Orderbook, OrderEntry } from "@/types"

interface WsLevel {
  price: string
  size: string
}

interface OrderbookMessage {
  channel: string
  type: "subscribed/order_book" | "update/order_book"
  data: {
    market_id: number
    bids: WsLevel[]
    asks: WsLevel[]
    timestamp: number
  }
}

// ── Shared module-level orderbook cache ──
// All useOrderbook(marketId) instances share the same data per marketId.

interface OrderbookCache {
  bids: Map<string, OrderEntry>
  asks: Map<string, OrderEntry>
  snapshot: Orderbook | null
  version: number
  subscribers: number
  unsubscribeWs: (() => void) | null
  listeners: Set<() => void>
  resyncTimer: ReturnType<typeof setTimeout> | null
  onVisible: (() => void) | null
  // REST-resync coordination (see resyncFromRest). `resyncing` is both the
  // in-flight guard (only one resync at a time) and the "buffer deltas" flag.
  // `resyncBuffer` holds WS deltas that land WHILE a resync GET is in flight so
  // they can be replayed on top of the snapshot instead of being wiped by it.
  // `resyncCancelled` lets a WS full-snapshot supersede an in-flight REST
  // resync (a live WS snapshot is newer than an already-stale REST payload).
  resyncing: boolean
  resyncBuffer: OrderbookMessage[]
  resyncCancelled: boolean
}

const cacheMap = new Map<number, OrderbookCache>()

function getCache(marketId: number): OrderbookCache {
  let cache = cacheMap.get(marketId)
  if (!cache) {
    cache = {
      bids: new Map(),
      asks: new Map(),
      snapshot: null,
      version: 0,
      subscribers: 0,
      unsubscribeWs: null,
      listeners: new Set(),
      resyncTimer: null,
      onVisible: null,
      resyncing: false,
      resyncBuffer: [],
      resyncCancelled: false,
    }
    cacheMap.set(marketId, cache)
  }
  return cache
}

const MAX_LEVELS = 50 // Only keep top N levels per side

function buildSnapshot(cache: OrderbookCache): Orderbook {
  const bids = Array.from(cache.bids.values()).sort(
    (a, b) => parseFloat(b.price) - parseFloat(a.price)
  )
  const asks = Array.from(cache.asks.values()).sort(
    (a, b) => parseFloat(a.price) - parseFloat(b.price)
  )

  // Remove only the exact crossed levels (bid price that equals or exceeds best ask)
  // This is less aggressive than midPrice filtering — only removes the overlapping levels
  if (bids.length > 0 && asks.length > 0) {
    const bestAsk = parseFloat(asks[0].price)
    const bestBid = parseFloat(bids[0].price)
    if (bestBid >= bestAsk) {
      const filteredBids = bids.filter((b) => parseFloat(b.price) < bestAsk)
      return {
        bids: filteredBids.slice(0, MAX_LEVELS),
        asks: asks.slice(0, MAX_LEVELS),
      }
    }
  }

  const result = {
    bids: bids.slice(0, MAX_LEVELS),
    asks: asks.slice(0, MAX_LEVELS),
  }

  // Trim far-away levels from the Map to prevent unbounded growth (after building result)
  if (cache.bids.size > MAX_LEVELS * 2) {
    const keepBids = new Set(result.bids.map((b) => b.price))
    for (const key of cache.bids.keys()) {
      if (!keepBids.has(key)) cache.bids.delete(key)
    }
  }
  if (cache.asks.size > MAX_LEVELS * 2) {
    const keepAsks = new Set(result.asks.map((a) => a.price))
    for (const key of cache.asks.keys()) {
      if (!keepAsks.has(key)) cache.asks.delete(key)
    }
  }

  return result
}

const throttleTimers = new Map<number, ReturnType<typeof setTimeout>>()
const lastNotify = new Map<number, number>()
const THROTTLE_MS = 100 // Max 10 updates/sec

function notifyListeners(cache: OrderbookCache, marketId?: number) {
  const key = marketId ?? 0
  const now = Date.now()
  const last = lastNotify.get(key) ?? 0

  // If enough time passed, notify immediately (leading edge)
  if (now - last >= THROTTLE_MS) {
    lastNotify.set(key, now)
    if (throttleTimers.has(key)) {
      clearTimeout(throttleTimers.get(key))
      throttleTimers.delete(key)
    }
    cache.version++
    cache.snapshot = buildSnapshot(cache)
    for (const listener of cache.listeners) {
      listener()
    }
    return
  }

  // Otherwise schedule trailing edge
  if (throttleTimers.has(key)) return
  throttleTimers.set(
    key,
    setTimeout(
      () => {
        throttleTimers.delete(key)
        lastNotify.set(key, Date.now())
        cache.version++
        cache.snapshot = buildSnapshot(cache)
        for (const listener of cache.listeners) {
          listener()
        }
      },
      THROTTLE_MS - (now - last)
    )
  )
}

function applySnapshot(cache: OrderbookCache, msg: OrderbookMessage) {
  // Only clear a side if the snapshot has data for it — prevents wiping one side
  if (msg.data.bids.length > 0) {
    cache.bids.clear()
    for (const level of msg.data.bids) {
      cache.bids.set(level.price, {
        price: level.price,
        size: level.size,
        orders: "1",
      })
    }
  }
  if (msg.data.asks.length > 0) {
    cache.asks.clear()
    for (const level of msg.data.asks) {
      cache.asks.set(level.price, {
        price: level.price,
        size: level.size,
        orders: "1",
      })
    }
  }
}

// ── Periodic REST resync (SAFETY NET) ──
// The realtime book is 100% WebSocket (snapshot-once + deltas-forever); this
// REST resync only CORRECTS residual drift, it is not the live data path.
//
// The server-side drift causes are now fixed (ELP-382: slow consumers are
// DISCONNECTED instead of silently dropped, so they reconnect to a fresh
// snapshot; ELP-395: the read model is republished before cancel/amend
// broadcasts, so deletions actually propagate). With those in place the WS
// should stay accurate on its own, so this poll is kept only as a wide safety
// net at a long period rather than removed outright — a rare missed delta still
// self-heals within one period.
//
// Aligned to WALL-CLOCK boundaries (`Date.now() % PERIOD === 0`) rather than a
// per-client interval, so every browser pulls the authoritative snapshot at the
// SAME absolute instant and side-by-side screens converge together. Keep the
// period a divisor of 60s (30s → :00 :30 each minute) so that alignment holds.
// Hidden tabs skip the fetch and resync on refocus via `visibilitychange`.
const RESYNC_PERIOD_MS = 30_000

// Schedule the next resync at the upcoming wall-clock boundary, then reschedule
// itself. Self-cancels if the market's cache was torn down while waiting.
function scheduleAlignedResync(marketId: number) {
  const cache = cacheMap.get(marketId)
  if (!cache) return
  const msToBoundary = RESYNC_PERIOD_MS - (Date.now() % RESYNC_PERIOD_MS)
  cache.resyncTimer = setTimeout(() => {
    const live = cacheMap.get(marketId)
    if (!live || live !== cache) return // unsubscribed while waiting
    if (document.visibilityState === "visible") resyncFromRest(marketId)
    scheduleAlignedResync(marketId)
  }, msToBoundary)
}

async function resyncFromRest(marketId: number) {
  const cache = cacheMap.get(marketId)
  // In-flight guard: never overlap two resyncs (the 5s interval and the
  // visibilitychange handler can both fire, and a slow GET can outlive the
  // next tick — an older response resolving last would clobber a fresher one).
  if (!cache || cache.resyncing) return

  cache.resyncing = true
  cache.resyncCancelled = false
  cache.resyncBuffer = []
  try {
    const book = await apiClient<Orderbook>(`/orderbook/${marketId}`)

    // Bail if the world moved under us during the await.
    if (cacheMap.get(marketId) !== cache) return // last subscriber left
    if (cache.resyncCancelled) return // a WS full-snapshot superseded this

    const bids = book?.bids ?? []
    const asks = book?.asks ?? []
    // Don't wipe the book on a flaky empty payload; a genuinely empty book
    // still reaches us via WS deltas.
    if (bids.length === 0 && asks.length === 0) return

    // Replace BOTH sides wholesale — the point is to drop phantom levels a
    // missed size=0 delta left behind, which merging could never remove.
    cache.bids.clear()
    cache.asks.clear()
    for (const l of bids) {
      cache.bids.set(l.price, {
        price: l.price,
        size: l.size,
        orders: l.orders ?? "1",
      })
    }
    for (const l of asks) {
      cache.asks.set(l.price, {
        price: l.price,
        size: l.size,
        orders: l.orders ?? "1",
      })
    }
    // CRITICAL: replay any WS deltas that arrived while the GET was in flight,
    // ON TOP of the snapshot. The REST payload is a point-in-time from when the
    // request was issued (~50-300ms ago); a delta that landed since is NEWER,
    // so without this replay the snapshot would resurrect a level that delta
    // just removed — reintroducing the very drift this resync exists to fix.
    for (const msg of cache.resyncBuffer) applyDelta(cache, msg)

    notifyListeners(cache, marketId)
  } catch {
    // transient — the next tick retries
  } finally {
    cache.resyncing = false
    cache.resyncBuffer = []
  }
}

function applyDelta(cache: OrderbookCache, msg: OrderbookMessage) {
  for (const level of msg.data.bids) {
    if (parseFloat(level.size) === 0) cache.bids.delete(level.price)
    else
      cache.bids.set(level.price, {
        price: level.price,
        size: level.size,
        orders: "1",
      })
  }
  for (const level of msg.data.asks) {
    if (parseFloat(level.size) === 0) cache.asks.delete(level.price)
    else
      cache.asks.set(level.price, {
        price: level.price,
        size: level.size,
        orders: "1",
      })
  }
}

export function useOrderbook(marketId: number) {
  const { subscribe, isConnected } = useWebSocket()
  const useWs = isConnected

  const cache = getCache(marketId)

  // Subscribe to cache changes via useSyncExternalStore
  const snapshot = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        cache.listeners.add(onStoreChange)
        return () => {
          cache.listeners.delete(onStoreChange)
        }
      },
      [cache]
    ),
    () => cache.snapshot,
    () => cache.snapshot
  )

  // WS subscription — one shared handler per marketId (ref-counted)
  useEffect(() => {
    if (!useWs || marketId <= 0) return

    const c = getCache(marketId)
    c.subscribers++

    // Only subscribe on first instance
    if (c.subscribers === 1) {
      // Wall-clock-aligned resync (see scheduleAlignedResync); the callback
      // skips the fetch while hidden — a throttled tab resyncs on resume.
      scheduleAlignedResync(marketId)
      c.onVisible = () => {
        if (document.visibilityState === "visible") resyncFromRest(marketId)
      }
      document.addEventListener("visibilitychange", c.onVisible)

      const channel = `order_book/${marketId}`
      c.unsubscribeWs = subscribe(channel, (raw: unknown) => {
        const msg = raw as OrderbookMessage
        const cc = getCache(marketId)

        if (msg.type === "subscribed/order_book") {
          if (msg.data.bids.length > 0 || msg.data.asks.length > 0) {
            // A fresh WS snapshot is authoritative and newer than any REST
            // resync already in flight — cancel that resync's pending apply so
            // it can't overwrite this with an older payload.
            cc.resyncCancelled = true
            applySnapshot(cc, msg)
            cc.version++
            cc.snapshot = buildSnapshot(cc)
            for (const l of cc.listeners) l()
          }
        } else if (msg.type === "update/order_book") {
          applyDelta(cc, msg)
          // If a REST resync is mid-fetch, also record this delta so it gets
          // replayed on top of the snapshot instead of being wiped by it.
          if (cc.resyncing) cc.resyncBuffer.push(msg)
          notifyListeners(cc, marketId)
        }
      })
    }

    return () => {
      const c = getCache(marketId)
      c.subscribers--
      if (c.subscribers === 0) {
        if (c.unsubscribeWs) {
          c.unsubscribeWs()
          c.unsubscribeWs = null
        }
        if (c.resyncTimer) {
          clearTimeout(c.resyncTimer)
          c.resyncTimer = null
        }
        if (c.onVisible) {
          document.removeEventListener("visibilitychange", c.onVisible)
          c.onVisible = null
        }
        // Cancel an in-flight resync so its .then() can't touch a dead cache.
        c.resyncing = false
        c.resyncCancelled = true
        c.resyncBuffer = []
        // Clean up module-level maps to prevent memory leak. Clear (not just
        // delete) any pending trailing-throttle timer first — otherwise it
        // fires ~100ms later and re-inserts the lastNotify entry we just
        // removed, leaking one map entry per market visited.
        const pending = throttleTimers.get(marketId)
        if (pending) clearTimeout(pending)
        cacheMap.delete(marketId)
        throttleTimers.delete(marketId)
        lastNotify.delete(marketId)
      }
    }
  }, [marketId, useWs, subscribe])

  return {
    data: snapshot ?? undefined,
    isLoading: false,
    error: null,
  }
}
