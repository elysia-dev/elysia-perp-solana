"use client"

import { useEffect } from "react"
import { ClosePositionModal } from "@/components/modals/ClosePositionModal"
import { useClosePositionModal } from "@/lib/stores/useClosePositionModal"
import { usePositionsList } from "@/lib/hooks/usePositions"

/**
 * Always-mounted host for the Close-Position modal, driven by the store — the
 * single modal instance both the chart's on-line Close (X) button and the
 * Positions table's Close button open (via `requestClose`).
 *
 * The store only records WHICH position was requested; the modal is fed the
 * LIVE row from the positions list so size/PnL stay current while it's open,
 * and it auto-closes if the position disappears (filled close, liquidation).
 */
export function ClosePositionModalHost() {
  const requested = useClosePositionModal((s) => s.position)
  const clear = useClosePositionModal((s) => s.clear)
  const positions = usePositionsList()

  const live = requested
    ? (positions.find(
        (p) => p.market === requested.market && p.side === requested.side
      ) ?? null)
    : null

  // Requested position no longer exists → close the modal instead of showing
  // a stale snapshot the user can no longer act on.
  useEffect(() => {
    if (requested && !live) clear()
  }, [requested, live, clear])

  // The store outlives this page; clear any pending request on unmount so
  // navigating back doesn't resurrect an old modal.
  useEffect(() => () => useClosePositionModal.getState().clear(), [])

  return (
    <ClosePositionModal
      position={live}
      open={live != null}
      onOpenChange={(open) => {
        if (!open) clear()
      }}
    />
  )
}
