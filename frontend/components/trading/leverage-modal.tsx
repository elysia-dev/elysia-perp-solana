"use client"

import { useState, useEffect, useMemo } from "react"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUpdateLeverage } from "@/lib/hooks/useUpdateLeverage"
import { useCurrentMarketPosition } from "@/lib/hooks/usePositions"
import { toOrderErrorReason } from "@/lib/utils/orderError"

interface LeverageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leverage: number
  onConfirm: (leverage: number) => void
  side: "buy" | "sell"
  market: string // Market name for API call (e.g., "BTC-PERP")
  maxLeverage?: number
}

export function LeverageModal({
  open,
  onOpenChange,
  leverage,
  onConfirm,
  side,
  market,
  maxLeverage = 50,
}: LeverageModalProps) {
  const [tempLeverage, setTempLeverage] = useState<number>(leverage)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const updateLeverage = useUpdateLeverage()
  const currentMarketPosition = useCurrentMarketPosition(market)

  const currentPositionLeverage = useMemo(() => {
    if (currentMarketPosition) {
      const { size, margin, mark_price: markPriceStr } = currentMarketPosition
      const markPrice = parseFloat(markPriceStr)
      return parseFloat(
        ((markPrice * parseFloat(size)) / parseFloat(margin)).toFixed(2)
      )
    }
    return undefined
  }, [currentMarketPosition])

  // Update tempLeverage when leverage prop changes
  useEffect(() => {
    setTempLeverage(leverage)
  }, [leverage])

  // Reset tempLeverage when modal opens
  useEffect(() => {
    if (open) {
      setTempLeverage(leverage)
      setErrorMsg(null)
    }
  }, [open, leverage])

  // Clear a stale error once the user changes the value again.
  useEffect(() => {
    setErrorMsg(null)
  }, [tempLeverage])

  const handleConfirm = () => {
    setErrorMsg(null)
    updateLeverage.mutate(
      { market, leverage: tempLeverage },
      {
        onSuccess: () => {
          onConfirm(tempLeverage)
          onOpenChange(false)
        },
        // Surface the backend reason (e.g. "Cannot decrease leverage while
        // open orders exist…") instead of failing silently. `toOrderErrorReason`
        // unwraps the Rust error and falls back to the raw message.
        onError: (err) => setErrorMsg(toOrderErrorReason(err)),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-xs flex max-h-[95vh] w-[440px] flex-col overflow-hidden rounded-lg border bg-card p-0">
        <DialogHeader className="flex items-center justify-between border-b p-3">
          <DialogTitle className="hidden"></DialogTitle>
          <DialogDescription className="sr-only">
            Set the maximum leverage used for new orders in this market.
          </DialogDescription>
          <div className="flex items-center gap-2">
            <span>Adjust Max Leverage</span>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-scroll">
          {/* Leverage Slider */}
          <div className="flex items-center justify-between gap-2 border-b p-3">
            <Slider
              value={tempLeverage}
              onValueChange={setTempLeverage}
              variant={side}
              showInput={true}
              min={1}
              max={maxLeverage}
              inputSuffix="x"
            />
          </div>

          {/* Info Text */}
          <div className="flex flex-col gap-2 p-3">
            <p className="text-xs">
              Set the maximum leverage you are willing to use. Higher leverage
              increases the risk of liquidation.
            </p>
            <p className="text-xs">Current Maximum Leverage: {leverage}x</p>
            <p className="text-xs">
              Current Position Leverage:{" "}
              {currentPositionLeverage != null
                ? `${currentPositionLeverage}x`
                : "No position"}
            </p>

            {/* Error: below current position leverage */}
            {currentPositionLeverage != null &&
              tempLeverage < currentPositionLeverage && (
                <div className="text-xs bg-destructive/10 text-destructive rounded-sm border p-2">
                  Leverage cannot be set below the current position leverage (
                  {currentPositionLeverage}x).
                </div>
              )}

            {/* Error: backend rejection (e.g. open orders, out-of-range IMF) */}
            {errorMsg && (
              <div className="text-xs bg-destructive/10 text-destructive rounded-sm border p-2 break-words">
                {errorMsg}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t p-3">
          <button
            data-testid="adjust-leverage-modal-confirm"
            onClick={handleConfirm}
            disabled={
              updateLeverage.isPending ||
              (currentPositionLeverage != null &&
                tempLeverage < currentPositionLeverage)
            }
            className="group w-full cursor-pointer items-center justify-center truncate rounded border text-xs font-medium transition-all disabled:cursor-auto disabled:opacity-50 h-8 gap-2 p-2"
          >
            <span>{updateLeverage.isPending ? "Updating..." : "Confirm"}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
