"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDevModeStore } from "@/lib/stores/useDevModeStore"

interface MarginModeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  marginMode: "Isolated" | "Cross"
  onConfirm: (marginMode: "Isolated" | "Cross") => void
  hasActiveOrdersOrPositions?: boolean
}

const MARGIN_MODE_OPTIONS = [
  {
    value: "Cross" as const,
    title: "Cross Currently Not Supported",
    description:
      "All cross positions share the same cross margin as collateral. In the event of liquidation, your cross margin balance and any remaining open positions under assets in this mode may be forfeited.",
  },
  {
    value: "Isolated" as const,
    title: "Isolated",
    description:
      "Manage your risk on individual positions by restricting the amount of margin allocated to each. If the margin ratio of an isolated position reaches 100%, the position will be liquidated. Margin can be added or removed to individual positions in this mode.",
  },
]

export function MarginModeModal({
  open,
  onOpenChange,
  marginMode,
  onConfirm,
  hasActiveOrdersOrPositions = false,
}: MarginModeModalProps) {
  const [tempMarginMode, setTempMarginMode] = useState<"Isolated" | "Cross">(
    marginMode
  )

  // Update tempMarginMode when marginMode prop changes
  useEffect(() => {
    setTempMarginMode(marginMode)
  }, [marginMode])

  // Reset tempMarginMode when modal opens
  useEffect(() => {
    if (open) {
      setTempMarginMode(marginMode)
    }
  }, [open, marginMode])

  const handleConfirm = () => {
    onConfirm(tempMarginMode)
    onOpenChange(false)
  }

  const isDisabled = hasActiveOrdersOrPositions

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-xs flex max-h-[95vh] w-[440px] flex-col overflow-hidden rounded-lg border bg-card p-0">
        <DialogHeader className="flex items-center justify-between border-b border-b-border p-3">
          <DialogTitle className="hidden"></DialogTitle>
          <DialogDescription className="sr-only">
            Choose Cross or Isolated margin for this market.
          </DialogDescription>
          <div
            className="flex items-center gap-2 select-none"
            onClick={() => useDevModeStore.getState().tap()}
          >
            <span>Margin Mode</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-scroll">
          <div className="flex flex-col gap-3 p-3">
            {MARGIN_MODE_OPTIONS.map((option) => {
              const isSelected = tempMarginMode === option.value
              return (
                <div
                  key={option.value}
                  className={`flex flex-col gap-1 rounded-sm border p-2 ${option.value === "Cross" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-1">
                    <label className="flex w-fit cursor-pointer items-center gap-1">
                      <input
                        readOnly
                        className="sr-only"
                        type="checkbox"
                        checked={isSelected}
                        disabled={option.value === "Cross" || isDisabled} // TODO: after implement cross margin, remove this
                        onChange={() => {
                          setTempMarginMode(option.value)
                        }}
                      />
                      <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-foreground">
                        <svg
                          className={`transition ${
                            isSelected
                              ? "scale-100 rotate-0 opacity-100"
                              : "scale-0 -rotate-45 opacity-0"
                          }`}
                          width="8"
                          height="6"
                          viewBox="0 0 8 6"
                          stroke="currentColor"
                          fill="none"
                        >
                          <path
                            d="M1 3L3 5L7 1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          ></path>
                        </svg>
                      </span>
                      <span className="text-xs"></span>
                    </label>
                    <span className="text-sm">{option.title}</span>
                  </div>
                  <p className="text-xs font-light">{option.description}</p>
                </div>
              )
            })}

            {hasActiveOrdersOrPositions && (
              <div className="text-xs bg-destructive/10 text-destructive rounded-sm border p-2">
                Cannot modify margin mode due to open active orders or positions
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t p-3 *:flex-1">
          <button
            data-testid="margin-mode-modal-confirm"
            onClick={handleConfirm}
            className="group inline-flex w-fit shrink-0 cursor-pointer items-center justify-center truncate rounded border text-xs font-medium transition-all disabled:cursor-auto disabled:opacity-50 h-8 gap-2 p-2"
          >
            <span>Confirm</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
