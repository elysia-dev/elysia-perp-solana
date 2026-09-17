"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { useState, useEffect, useMemo, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronDown, Pencil } from "lucide-react"
import { useClosePosition } from "@/lib/hooks/useClosePosition"
import { useOrderbook } from "@/lib/hooks/useOrderbook"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { FEE_TICK } from "@/lib/constants/scaling"
import { formatNumber, getAssetName } from "@/lib/utils"
import { toOrderErrorReason } from "@/lib/utils/orderError"
import { positionLiquidationPrice } from "@/lib/utils/liquidation"
import {
  useMarkPriceStore,
  selectMarkPrice,
  useMarketStore,
} from "@/lib/stores"
import type { Position } from "@/types"
import { sideToIsAsk } from "@/types"
import type { OrderEntry } from "@/types/orderbook"

interface ClosePositionModalProps {
  position: Position | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AmountUnit = "USD" | "ASSET"

import { useTradingFormStore, MAX_SLIPPAGE } from "@/lib/stores"

type LiquidityWarning = "none" | "insufficient" | "insufficient_in_slippage"

/**
 * Calculate VWAP by consuming orderbook entries up to `targetSize`.
 * For closing Long → consume bids; for closing Short → consume asks.
 * `priceLimit` restricts entries within slippage range.
 *
 * Returns { vwap, filledSize, totalBookSize, totalBookSizeInRange }
 */
function calculateVWAP(
  entries: OrderEntry[],
  targetSize: number,
  priceLimit: number,
  side: "Long" | "Short"
): {
  vwap: number
  filledSize: number
  totalBookSize: number
  totalBookSizeInRange: number
} {
  let filledSize = 0
  let totalCost = 0
  let totalBookSize = 0
  let totalBookSizeInRange = 0

  for (const entry of entries) {
    const price = parseFloat(entry.price)
    const size = parseFloat(entry.size)
    totalBookSize += size

    // Check if within slippage range
    const inRange =
      side === "Long"
        ? price >= priceLimit // Closing Long → selling → consume bids >= min price
        : price <= priceLimit // Closing Short → buying → consume asks <= max price

    if (!inRange) continue

    totalBookSizeInRange += size

    if (filledSize >= targetSize) continue

    const remaining = targetSize - filledSize
    const fillAmount = Math.min(size, remaining)
    filledSize += fillAmount
    totalCost += fillAmount * price
  }

  const vwap = filledSize > 0 ? totalCost / filledSize : 0
  return { vwap, filledSize, totalBookSize, totalBookSizeInRange }
}

export function ClosePositionModal({
  position,
  open,
  onOpenChange,
}: ClosePositionModalProps) {
  const closePosition = useClosePosition()
  const { data: orderBookDetailsData } = useOrderBookDetails()
  // Convert fee ticks to % the same way the order form does so both
  // screens agree.
  const closeMarketDetail = orderBookDetailsData?.order_book_details?.find(
    (d) => d.symbol === position?.market
  )
  const closeTakerFeePercent = closeMarketDetail
    ? (parseFloat(closeMarketDetail.taker_fee) / FEE_TICK) * 100
    : 0
  const closeMakerFeePercent = closeMarketDetail
    ? (parseFloat(closeMarketDetail.maker_fee) / FEE_TICK) * 100
    : 0
  const closeFeeDisplay = `Taker: ${closeTakerFeePercent.toFixed(2)}% | Maker: ${closeMakerFeePercent.toFixed(2)}%`
  const maxSlippage = useTradingFormStore((s) => s.maxSlippage)
  const setMaxSlippage = useTradingFormStore((s) => s.setMaxSlippage)
  const [isSlippageOpen, setIsSlippageOpen] = useState(false)
  const [customSlippage, setCustomSlippage] = useState("")
  const slippageRef = useRef<HTMLDivElement>(null)

  // Same input policy as the order form's slippage editor: digits only, one
  // decimal point, ≤2 decimal places, and anything over MAX_SLIPPAGE snaps to
  // the cap (clamped, not silently ignored). The store clamps again on write.
  const handleCustomSlippageChange = (raw: string) => {
    if (raw === "") {
      setCustomSlippage("")
      return
    }
    if (!/^\d*\.?\d{0,2}$/.test(raw)) return
    const val = parseFloat(raw)
    setCustomSlippage(val > MAX_SLIPPAGE ? String(MAX_SLIPPAGE) : raw)
  }
  const handleCustomSlippage = () => {
    const val = parseFloat(customSlippage)
    if (!Number.isFinite(val) || val <= 0) return
    setMaxSlippage(Math.min(val, MAX_SLIPPAGE))
    setIsSlippageOpen(false)
    setCustomSlippage("")
  }

  const [percentage, setPercentage] = useState(100)
  const [isLimit, setIsLimit] = useState(false)
  const [limitPrice, setLimitPrice] = useState("")
  const [amountUnit, setAmountUnit] = useState<AmountUnit>("USD")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // While the user is typing in the Amount field, hold the raw string here so
  // the input shows exactly what they type; `null` = show the value derived
  // from `percentage` (slider-driven). Cleared whenever percentage changes by
  // another control so the field re-syncs.
  const [amountEditing, setAmountEditing] = useState<string | null>(null)
  const prevOpenRef = useRef(false)

  // Extract asset symbol from market (e.g., "BTC-PERP" -> "BTC")
  const assetSymbol = useMemo(() => {
    if (!position) return ""
    return marketDisplayLabel(position.market)
  }, [position])

  // Use live mark price from store (polled every 1s), fallback to position snapshot
  const marketSymbol = position?.market ?? ""
  const liveMarkPrice = useMarkPriceStore(selectMarkPrice(marketSymbol))
  const currentMarkPrice =
    liveMarkPrice > 0
      ? liveMarkPrice
      : position
        ? parseFloat(position.mark_price)
        : 0

  // Get market ID for orderbook lookup
  const pairs = useMarketStore((s) => s.pairs)
  const marketId = useMemo(() => {
    const pair = pairs.find((p) => p.name === marketSymbol)
    return pair?.id ?? 0
  }, [pairs, marketSymbol])

  // Quote token for this position (multi-token, ELP-133): margin/value/PnL are
  // denominated in it (EL$ for BTC-PERP, USDT for BTC-PERP-USDT). Read the
  // server-authoritative id straight off the position rather than by market name.
  const quoteSymbol =
    position != null ? getAssetName(position.quote_asset_id) : ""

  // Live orderbook data (polled every 0.3s)
  const { data: orderbook } = useOrderbook(marketId)

  // Position size (full position available for closing)
  const positionSize = useMemo(() => {
    if (!position) return 0
    return parseFloat(position.size)
  }, [position])

  // Reset state only when modal opens (not on every markPriceData update)
  useEffect(() => {
    // Only initialize when modal opens (open changes from false to true)
    if (open && !prevOpenRef.current && position) {
      setPercentage(100)
      setIsLimit(false)
      setLimitPrice("")
      setAmountUnit("USD")
      setErrorMsg(null)
      setAmountEditing(null)
    }
    prevOpenRef.current = open
  }, [open, position])

  // Close slippage editor on outside click
  useEffect(() => {
    if (!isSlippageOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        slippageRef.current &&
        !slippageRef.current.contains(e.target as Node)
      ) {
        setIsSlippageOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [isSlippageOpen])

  // Set limit price to current mark price when Limit is enabled
  const handleLimitChange = (checked: boolean) => {
    setIsLimit(checked)
    if (checked && !limitPrice) {
      setLimitPrice(currentMarkPrice.toString())
    }
  }

  // Calculated values
  const calculations = useMemo(() => {
    if (!position) {
      return {
        positionValue: 0,
        closeSize: "0",
        remainingSize: "0",
        remainingMargin: "0",
        estimatedPnL: 0,
        liquidityWarning: "none" as LiquidityWarning,
      }
    }

    const margin = parseFloat(position.margin)
    const entryPrice = parseFloat(position.entry_price)

    const closeRatio = percentage / 100
    const closeSize = positionSize * closeRatio
    const remainingSize = positionSize - closeSize
    const remainingMargin = margin * (remainingSize / positionSize)
    const positionValue = positionSize * currentMarkPrice

    let estimatedPnL = 0
    let liquidityWarning: LiquidityWarning = "none"

    if (closeSize > 0) {
      if (isLimit && limitPrice) {
        // Limit order: use user's limit price directly
        const lp = parseFloat(limitPrice)
        if (lp > 0) {
          estimatedPnL =
            position.side === "Long"
              ? (lp - entryPrice) * closeSize
              : (entryPrice - lp) * closeSize
        }
      } else if (orderbook) {
        // Market order: VWAP from orderbook within slippage range
        const entries =
          position.side === "Long" ? orderbook.bids : orderbook.asks
        const priceLimit =
          position.side === "Long"
            ? currentMarkPrice * (1 - maxSlippage / 100) // min bid price
            : currentMarkPrice * (1 + maxSlippage / 100) // max ask price

        const { vwap, filledSize, totalBookSize, totalBookSizeInRange } =
          calculateVWAP(entries, closeSize, priceLimit, position.side)

        // Determine liquidity warning
        if (totalBookSize < closeSize) {
          liquidityWarning = "insufficient"
        } else if (totalBookSizeInRange < closeSize) {
          liquidityWarning = "insufficient_in_slippage"
        }

        // PnL based on fillable volume only
        const effectiveSize = Math.min(closeSize, filledSize)
        if (vwap > 0 && effectiveSize > 0) {
          estimatedPnL =
            position.side === "Long"
              ? (vwap - entryPrice) * effectiveSize
              : (entryPrice - vwap) * effectiveSize
        }
      }
    }

    return {
      positionValue,
      closeSize: closeSize.toString(),
      remainingSize: Math.max(0, remainingSize).toString(),
      remainingMargin: Math.max(0, remainingMargin).toString(),
      estimatedPnL,
      liquidityWarning,
    }
  }, [
    position,
    percentage,
    positionSize,
    currentMarkPrice,
    isLimit,
    limitPrice,
    orderbook,
    maxSlippage,
  ])

  // Full close amount in the selected unit (100% of the position).
  const maxAmountInUnit =
    amountUnit === "USD" ? positionSize * currentMarkPrice : positionSize

  // Value derived from the current percentage, in the selected unit.
  const derivedAmount = maxAmountInUnit * (percentage / 100)

  // Format an amount in the selected unit for display (comma-free, trimmed).
  const formatAmount = (v: number) =>
    v.toFixed(amountUnit === "USD" ? 2 : 6).replace(/\.?0+$/, "")

  // What the Amount field shows: the user's raw text while editing, else the
  // slider-derived value.
  const amountFieldValue =
    amountEditing ?? (derivedAmount > 0 ? formatAmount(derivedAmount) : "")

  // Typing an amount drives the percentage (and thus closeSize/slider).
  const handleAmountInput = (raw: string) => {
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return // digits + one dot only
    const v = parseFloat(raw)
    if (!Number.isFinite(v) || v <= 0) {
      setAmountEditing(raw)
      setPercentage(0)
      return
    }
    // Can't close more than you hold: clamp the amount itself to the position
    // value (not just the percentage) so the field never shows an over-max
    // figure. Snapping to the max keeps input and slider consistent.
    if (maxAmountInUnit > 0 && v > maxAmountInUnit) {
      setAmountEditing(formatAmount(maxAmountInUnit))
      setPercentage(100)
      return
    }
    setAmountEditing(raw)
    setPercentage(maxAmountInUnit > 0 ? (v / maxAmountInUnit) * 100 : 0)
  }

  // Any percentage change from another control (slider, unit switch, reset)
  // re-syncs the field back to the derived value.
  const setPercentageFromSlider = (p: number) => {
    setAmountEditing(null)
    setPercentage(p)
  }

  // Calculate market order price with slippage
  const getMarketOrderPrice = (): string => {
    // For closing position: opposite side of current position
    // Closing Long (selling) -> lower price (1 - slippage)
    // Closing Short (buying) -> higher price (1 + slippage)
    const slippageMultiplier =
      position?.side === "Long" ? 1 - maxSlippage / 100 : 1 + maxSlippage / 100
    return (currentMarkPrice * slippageMultiplier).toString()
  }

  const handleClosePosition = () => {
    if (
      !position ||
      positionSize <= 0 ||
      percentage === 0 ||
      parseFloat(calculations.closeSize) === 0
    )
      return

    setErrorMsg(null)
    const closeSide = position.side === "Long" ? "Short" : "Long"
    closePosition.mutate(
      {
        market: position.market,
        side: closeSide,
        is_ask: sideToIsAsk(closeSide),
        price: isLimit ? limitPrice : getMarketOrderPrice(),
        size: calculations.closeSize,
        base_amount: calculations.closeSize,
        order_type: isLimit ? 0 : 1,
        reduce_only: true,
        margin_mode: 1,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        // Surface backend rejections (e.g. an existing reduce-only close order
        // already reserving the position) — without this the modal silently did
        // nothing on failure and the user couldn't tell why.
        onError: (err) => setErrorMsg(toOrderErrorReason(err)),
      }
    )
  }

  if (!position) return null

  const isFullClose = percentage === 100
  const isPnLPositive = calculations.estimatedPnL >= 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] w-[400px] flex-col overflow-hidden rounded-lg border bg-card p-0">
        <DialogHeader className="flex items-center justify-between border-b p-4">
          <DialogTitle className="text-sm font-medium">
            Close Position
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review the close amount, estimated PnL, and fees, then confirm to
            close this position.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-4">
          {/* Position Info */}
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Position Value</span>
              <span>
                {calculations.positionValue.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {quoteSymbol}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Position Size</span>
              <span
                className={
                  position.side === "Long" ? "text-success" : "text-destructive"
                }
              >
                {formatNumber(position.size)} {assetSymbol}
              </span>
            </div>
          </div>

          {/* Amount Input with Unit Selector */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2">
              <span className="text-xs text-muted-foreground">Amount</span>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountFieldValue}
                  onChange={(e) => handleAmountInput(e.target.value)}
                  placeholder="0"
                  className="w-24 bg-transparent text-right text-sm outline-none placeholder:text-muted-foreground"
                />
                <Select
                  value={amountUnit}
                  onValueChange={(value) => {
                    setAmountEditing(null)
                    setAmountUnit(value as AmountUnit)
                  }}
                >
                  <SelectTrigger className="h-6 w-fit gap-1 border-none bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">{quoteSymbol}</SelectItem>
                    <SelectItem value="ASSET">{assetSymbol}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Percentage Slider */}
            <Slider
              value={percentage}
              onValueChange={setPercentageFromSlider}
              variant="sell"
              min={0}
              max={100}
              inputSuffix="%"
            />
          </div>

          {/* Limit Checkbox */}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isLimit}
                onChange={(e) => handleLimitChange(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <span className="text-xs">Limit</span>
            </label>

            {/* Limit Price Input - only show when Limit is checked */}
            {isLimit && (
              <>
                <div className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    Limit Price
                  </span>
                  <Input
                    type="text"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    className="h-6 w-24 border-none bg-transparent p-0 text-right text-sm"
                  />
                </div>

                {/* Advanced Section (disabled) - only show when Limit is checked */}
                <div className="flex cursor-not-allowed items-center gap-1 opacity-50">
                  <span className="text-xs text-muted-foreground">
                    Advanced
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </div>
              </>
            )}
          </div>

          {/* Backend rejection (e.g. reduce-only conflict with a resting
              close order) — shown inline like the leverage modal's error. */}
          {errorMsg && (
            <div className="text-xs bg-destructive/10 text-destructive rounded-sm border p-2 break-words">
              {errorMsg}
            </div>
          )}

          {/* Close Position Button */}
          <Button
            onClick={handleClosePosition}
            disabled={
              closePosition.isPending ||
              percentage === 0 ||
              parseFloat(calculations.closeSize) === 0
            }
            className="h-10 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {closePosition.isPending ? "Closing..." : "Close Position"}
          </Button>

          {/* Position Details */}
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Position</span>
              <span>
                {formatNumber(position.size)} →{" "}
                {formatNumber(calculations.remainingSize)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Est. Liq. Price</span>
              <span>
                {positionLiquidationPrice(position).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                {isFullClose ? " → -" : ""}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Position Margin</span>
              <span>
                {parseFloat(position.margin).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {quoteSymbol} →{" "}
                {parseFloat(calculations.remainingMargin).toLocaleString(
                  "en-US",
                  { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                )}{" "}
                {quoteSymbol}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground underline decoration-dotted">
                Estimated Closed PnL
              </span>
              <span
                className={isPnLPositive ? "text-success" : "text-destructive"}
              >
                {isPnLPositive ? "" : "-"}
                {Math.abs(calculations.estimatedPnL).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                {quoteSymbol}
              </span>
            </div>

            {calculations.liquidityWarning !== "none" && (
              <div className="text-xs text-warning">
                {calculations.liquidityWarning === "insufficient"
                  ? "Insufficient liquidity"
                  : "Insufficient liquidity within slippage range"}
              </div>
            )}

            <div ref={slippageRef}>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Slippage</span>
                <button
                  type="button"
                  onClick={() => setIsSlippageOpen(!isSlippageOpen)}
                  className="inline-flex items-center gap-1 text-primary hover:text-primary/80 cursor-pointer"
                >
                  <span>{isLimit ? "-" : `Max: ${maxSlippage}%`}</span>
                  {!isLimit && <Pencil className="h-3 w-3" />}
                </button>
              </div>
              {isSlippageOpen && !isLimit && (
                <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-background p-2">
                  <div className="flex gap-1">
                    {[0.1, 0.3, 0.5, 1.0].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setMaxSlippage(preset)
                          setIsSlippageOpen(false)
                        }}
                        className={`flex-1 rounded px-1.5 py-1 text-[11px] tabular-nums transition-colors cursor-pointer ${
                          maxSlippage === preset
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Custom %"
                      value={customSlippage}
                      onChange={(e) =>
                        handleCustomSlippageChange(e.target.value)
                      }
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleCustomSlippage()
                      }
                      className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs tabular-nums outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={handleCustomSlippage}
                      className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Fees</span>
              <span>{closeFeeDisplay}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
