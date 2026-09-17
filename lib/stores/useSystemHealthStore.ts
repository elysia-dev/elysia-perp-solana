import { create } from "zustand"

// Two consecutive failures from the API client (or one terminal WS failure)
// are enough to flip the app into the unhealthy state. We don't want to be
// trigger-happy on a single blip, but waiting longer leaves the user staring
// at stale data.
const FAILURE_THRESHOLD = 2

interface SystemHealthState {
  isHealthy: boolean
  consecutiveFailures: number
  lastAttemptAt: number | null
  /** Force the system into the unhealthy state (e.g. WS max-reconnect). */
  setUnhealthy: () => void
  /** Force-recover after a manual retry succeeds. */
  setHealthy: () => void
  /** API call succeeded — clear the failure streak. */
  recordSuccess: () => void
  /** API call failed (5xx / network). Flips unhealthy at the threshold. */
  recordFailure: () => void
}

export const useSystemHealthStore = create<SystemHealthState>((set, get) => ({
  isHealthy: true,
  consecutiveFailures: 0,
  lastAttemptAt: null,
  setUnhealthy: () => set({ isHealthy: false, lastAttemptAt: Date.now() }),
  setHealthy: () =>
    set({ isHealthy: true, consecutiveFailures: 0, lastAttemptAt: Date.now() }),
  recordSuccess: () => {
    const state = get()
    if (state.isHealthy && state.consecutiveFailures === 0) return
    set({ isHealthy: true, consecutiveFailures: 0, lastAttemptAt: Date.now() })
  },
  recordFailure: () => {
    const next = get().consecutiveFailures + 1
    set({
      consecutiveFailures: next,
      isHealthy: next < FAILURE_THRESHOLD,
      lastAttemptAt: Date.now(),
    })
  },
}))
