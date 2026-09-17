"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAdjustMargin } from "@/lib/hooks/useAdjustMargin"
import { useBalance } from "@/lib/hooks/useBalance"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { useMarkPriceStore } from "@/lib/stores/useMarkPriceStore"
import { resolveLiveMarkPriceFromData } from "@/lib/utils/markPrice"
import {
  computeLiquidationPrice,
  mmfFractionOf,
  positionLiquidationPrice,
} from "@/lib/utils/liquidation"
import { getAssetName } from "@/lib/utils"
import { tradingToast } from "@/lib/utils/toast"
import type { Position } from "@/types"

interface ModifyMarginModalProps {
  position: Position | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Direction = "add" | "remove"

export function ModifyMarginModal({
  position,
  open,
  onOpenChange,
}: ModifyMarginModalProps) {
  const adjustMargin = useAdjustMargin()
  const { data: balance } = useBalance()
  const { data: orderBookDetailsData } = useOrderBookDetails()
  // Subscribe to just this position's live mark price, not the whole map.
  // The previous `(s) => s.markPrices` selector caused this modal to
  // re-render on every WS tick of *any* symbol; now it only re-renders
  // when the position's own market updates.
  const liveMarkPriceData = useMarkPriceStore((s) =>
    position ? s.markPrices.get(position.market) : undefined
  )
  const [direction, setDirection] = useState<Direction>("add")
  const [amount, setAmount] = useState("")

  // Reset on open/position change
  useEffect(() => {
    if (open) {
      setAmount("")
      setDirection("add")
    }
  }, [open, position?.market])

  // Margin is denominated in the position's quote token (multi-token, ELP-133).
  // Read the server-authoritative id straight off the position rather than a
  // name-based market lookup, which is unstable once two markets share a name.
  const quoteCurrency = position?.quote_asset_id
  const tokenSymbol = quoteCurrency != null ? getAssetName(quoteCurrency) : ""

  // Only the matching token's balance backs this margin. If the user holds none
  // of it, available is 0 — never fall back to another token's balance.
  const available = useMemo(() => {
    if (quoteCurrency == null) return 0
    const bal = balance?.balances?.find((b) => b.asset_id === quoteCurrency)
    return bal ? parseFloat(bal.available) : 0
  }, [balance, quoteCurrency])

  const currentMargin = position ? parseFloat(position.margin) : 0
  const amountNum = parseFloat(amount || "0")

  // For remove: cap so that nominal leverage (positionValue / margin) stays at
  // or below the user's max. We deliberately bound by margin alone (not equity)
  // to:
  //   1. Match the user's mental model — they set "max leverage 18x" and expect
  //      the displayed nominal leverage to stay ≤ 18x.
  //   2. Leave PnL as a safety buffer instead of pre-spending it, so the server's
  //      equity-based IMR check (equity_after > positionValue * IMF) doesn't get
  //      rejected when PnL fluctuates between preview and confirm.
  //
  // NOTE: `position.leverage` is misnamed in usePositions — it actually carries
  // `initial_margin_fraction` as a percentage (e.g. "20" for 5x leverage = 20% IMF).
  // Use it directly as the IMF percent.
  const maxRemovable = useMemo(() => {
    if (!position) return 0
    const size = parseFloat(position.size)
    const markPrice = parseFloat(position.mark_price)
    const positionValue = size * markPrice
    const imfPercent =
      parseFloat(position.leverage) > 0 ? parseFloat(position.leverage) : 10
    const initialMargin = positionValue * (imfPercent / 100)
    return Math.max(0, currentMargin - initialMargin)
  }, [position, currentMargin])

  const maxAmount = direction === "add" ? available : maxRemovable

  const newMargin =
    direction === "add" ? currentMargin + amountNum : currentMargin - amountNum

  // Estimate new liquidation price using the same formula as the backend.
  // Reads per-market MMF from OrderBookDetail (falls back to global MMF when
  // the symbol isn't in the response yet).
  const estLiqPrice = useMemo(() => {
    if (!position || newMargin <= 0) return null
    const size = parseFloat(position.size)
    if (size === 0) return null
    const marketDetail = orderBookDetailsData?.order_book_details?.find(
      (d) => d.symbol === position.market
    )
    return computeLiquidationPrice({
      side: position.side,
      entryPrice: parseFloat(position.entry_price),
      size,
      margin: newMargin,
      markPrice: resolveLiveMarkPriceFromData(
        liveMarkPriceData,
        position.mark_price
      ),
      mmf: mmfFractionOf(marketDetail),
      // Include accrued funding so the projected liq price matches the real
      // liquidation point (engine settles it into equity). See ELP-321.
      unrealizedFunding: parseFloat(position.funding_pnl),
    })
  }, [position, newMargin, orderBookDetailsData, liveMarkPriceData])

  // Current actual leverage (not IMF-based)
  const currentLeverage = useMemo(() => {
    if (!position || currentMargin <= 0) return 0
    const size = parseFloat(position.size)
    const markPrice = parseFloat(position.mark_price)
    return (size * markPrice) / currentMargin
  }, [position, currentMargin])

  // Estimate new leverage
  const newLeverage = useMemo(() => {
    if (!position || newMargin <= 0) return null
    const size = parseFloat(position.size)
    const markPrice = parseFloat(position.mark_price)
    return (size * markPrice) / newMargin
  }, [position, newMargin])

  const exceedsIMR = direction === "remove" && amountNum > maxRemovable

  const isValid =
    amountNum > 0 &&
    amountNum <= maxAmount &&
    (direction === "remove" ? newMargin > 0 : true) &&
    !exceedsIMR

  const handleConfirm = () => {
    if (!position || !isValid) return

    adjustMargin.mutate(
      {
        market: position.market,
        amount: amount,
        direction: direction === "add" ? 1 : 0,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
          tradingToast.success(
            "Margin updated",
            `${direction === "add" ? "Added" : "Removed"} ${amount} ${tokenSymbol} ${direction === "add" ? "to" : "from"} margin`
          )
        },
        onError: (err) => {
          tradingToast.error(
            "Margin update failed",
            err instanceof Error ? err.message : "Unknown error"
          )
        },
      }
    )
  }

  const handleMaxClick = () => {
    setAmount((Math.floor(maxAmount * 100) / 100).toFixed(2))
  }

  if (!position) return null

  const formatValue = (value: number) =>
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-lg">Modify Margin</DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-sm text-muted-foreground">
          Decrease the chance of liquidation by adding more margin or remove
          excess margin to use for other positions.
        </DialogDescription>

        {/* Direction Toggle */}
        <div className="grid grid-cols-2 gap-0 rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => {
              setDirection("add")
              setAmount("")
            }}
            className={`py-2 text-sm font-medium transition-colors ${
              direction === "add"
                ? "bg-muted text-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Add Margin
          </button>
          <button
            onClick={() => {
              setDirection("remove")
              setAmount("")
            }}
            className={`py-2 text-sm font-medium transition-colors ${
              direction === "remove"
                ? "bg-muted text-foreground"
                : "bg-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Subtract Margin
          </button>
        </div>

        {/* Max Available */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {direction === "add" ? "Max. Available" : "Max. Removable"}
          </span>
          <span className="font-medium">
            {formatValue(Math.floor(maxAmount * 100) / 100)} {tokenSymbol}
          </span>
        </div>

        {/* Amount Input */}
        <div className="relative">
          <Input
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value
              if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v)
            }}
            className="pr-16 font-mono"
          />
          <button
            onClick={handleMaxClick}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-primary hover:text-primary/80"
          >
            Max
          </button>
        </div>

        {/* Preview */}
        <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Margin</span>
            <span>
              {formatValue(currentMargin)}{" "}
              <span className="text-muted-foreground">→</span>{" "}
              <span
                className={amountNum > 0 ? "text-foreground font-medium" : ""}
              >
                {formatValue(newMargin)}
              </span>{" "}
              {tokenSymbol}
            </span>
          </div>
          {estLiqPrice !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Liq. Price</span>
              <span>
                {positionLiquidationPrice(position) > 0
                  ? formatValue(positionLiquidationPrice(position))
                  : "N/A"}
                {/* Only show the projected value once the user has typed an
                    amount, otherwise the unchanged arrow looks like a change. */}
                {amountNum > 0 && (
                  <>
                    {" "}
                    <span className="text-muted-foreground">→</span>{" "}
                    <span className="text-foreground font-medium">
                      {estLiqPrice > 0 ? formatValue(estLiqPrice) : "N/A"}
                    </span>
                  </>
                )}
              </span>
            </div>
          )}
          {newLeverage !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Leverage</span>
              <span>
                {currentLeverage.toFixed(2)}x{" "}
                <span className="text-muted-foreground">→</span>{" "}
                <span
                  className={
                    exceedsIMR
                      ? "text-destructive font-medium"
                      : amountNum > 0
                        ? "text-foreground font-medium"
                        : ""
                  }
                >
                  {newLeverage.toFixed(2)}x
                  {exceedsIMR && " (exceeds margin req.)"}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Confirm */}
        <Button
          onClick={handleConfirm}
          disabled={!isValid || adjustMargin.isPending}
          className="w-full"
        >
          {adjustMargin.isPending ? "Confirming..." : "Confirm"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
