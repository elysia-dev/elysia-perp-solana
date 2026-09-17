"use client"

import { usePositions } from "@/lib/hooks/usePositions"

/**
 * Activates the positions data + its WebSocket subscription at the top level
 * (e.g. page.tsx), independent of which child components mount.
 *
 * Previously this mirrored React Query positions into a Zustand
 * `usePositionStore` (with a structural-diff guard). That mirror was removed —
 * consumers now read positions directly from the query via `usePositionsList`
 * / `useCurrentMarketPosition`, which carry the same structural-stability
 * guarantee. This hook just keeps the underlying `usePositions` query (and the
 * `account_all` WS subscription it owns) alive for the page.
 */
export function usePositionSync() {
  usePositions()
}
