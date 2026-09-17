import { create } from "zustand"

interface DevModeState {
  enabled: boolean
  dataCheckEnabled: boolean
  tapCount: number
  lastTapTime: number
  tap: () => void
  toggleDataCheck: () => void
}

const TAP_THRESHOLD = 10
const TAP_TIMEOUT = 3000 // reset after 3s of inactivity

export const useDevModeStore = create<DevModeState>((set, get) => ({
  enabled: false,
  dataCheckEnabled: false,
  tapCount: 0,
  lastTapTime: 0,
  toggleDataCheck: () =>
    set((s) => ({ dataCheckEnabled: !s.dataCheckEnabled })),
  tap: () => {
    const now = Date.now()
    const { tapCount, lastTapTime, enabled } = get()

    if (enabled) return

    const newCount = now - lastTapTime > TAP_TIMEOUT ? 1 : tapCount + 1

    if (newCount >= TAP_THRESHOLD) {
      set({ enabled: true, tapCount: 0 })
    } else {
      set({ tapCount: newCount, lastTapTime: now })
    }
  },
}))
