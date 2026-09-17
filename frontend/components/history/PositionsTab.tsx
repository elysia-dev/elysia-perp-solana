"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Edit, X } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useClosingPositions } from "@/lib/stores/useClosingPositions"
import { useMarkPriceStore } from "@/lib/stores/useMarkPriceStore"
import { resolveLiveMarkPrice } from "@/lib/utils/markPrice"
import { computeUnrealizedPnl, computeRoePercent } from "@/lib/utils/pnl"
import { positionLiquidationPrice } from "@/lib/utils/liquidation"

import { useAccount } from "@/lib/hooks/useAccount"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { imfToLeverage } from "@/types"
import { useClosePositionModal } from "@/lib/stores/useClosePositionModal"
import { ModifyMarginModal } from "@/components/modals/ModifyMarginModal"
import { formatNumber, getAssetName } from "@/lib/utils"
import type { Position } from "@/types"

interface PositionsTabProps {
  positions?: Position[]
}

export function PositionsTab({ positions: propPositions }: PositionsTabProps) {
  const storePositions = usePositionsList()
  // Markets whose close order is accepted but not yet settled → "Closing…"
  const closingMarkets = useClosingPositions((s) => s.closing)
  const { data: accountData } = useAccount()
  const { data: orderBookDetailsData } = useOrderBookDetails()
  // Live mark prices keyed by symbol — drives real-time PnL/value updates
  const markPrices = useMarkPriceStore((s) => s.markPrices)

  const allPositions = propPositions ?? storePositions
  const positions = allPositions.filter((p) => parseFloat(p.size) !== 0)

  // Quote currency follows the position's own quote_asset_id (the token it was
  // actually opened with) — NOT the global ecosystem selector, which is a
  // browse-time UI affordance and must not retroactively rewrite open positions.
  const getQuoteCurrency = (position: Position): string =>
    getAssetName(position.quote_asset_id)

  const getUserLeverage = (position: Position): number => {
    // Use the position's own IMF from account data (not the trading form's current setting)
    const accountPosition = accountData?.accounts?.[0]?.positions?.find(
      (p) => p.symbol === position.market
    )
    if (accountPosition) {
      const imfPercent = parseFloat(accountPosition.initial_margin_fraction)
      if (imfPercent > 0) return Math.round(100 / imfPercent)
    }
    const detail = orderBookDetailsData?.order_book_details?.find(
      (d) => d.symbol === position.market
    )
    if (detail) return imfToLeverage(detail.default_initial_margin_fraction)
    return 10
  }

  const getActualLeverage = (position: Position): number => {
    const positionValue = calculatePositionValue(position)
    const margin = parseFloat(position.margin)
    if (margin <= 0) return 0
    return parseFloat((positionValue / margin).toFixed(2))
  }

  // Modal state. The Close-Position modal is a single store-driven instance
  // rendered by ClosePositionModalHost on the trade page (shared with the
  // chart's on-line Close button), so this tab only dispatches the request.
  const handleClosePosition = useClosePositionModal((s) => s.requestClose)
  const [marginPosition, setMarginPosition] = useState<Position | null>(null)
  const [isMarginModalOpen, setIsMarginModalOpen] = useState(false)

  const handleModifyMargin = (position: Position) => {
    setMarginPosition(position)
    setIsMarginModalOpen(true)
  }

  const getMarketSymbol = (market: string) => {
    // Extract symbol from market string (e.g., "BTC-PERP" -> "BTC")
    return marketDisplayLabel(market)
  }

  const getMarkPrice = (position: Position): number =>
    resolveLiveMarkPrice(markPrices, position.market, position.mark_price)

  const calculatePositionValue = (position: Position) => {
    const size = parseFloat(position.size)
    const markPrice = getMarkPrice(position)
    return size * markPrice
  }

  // Recompute PnL and ROE from live mark price so they tick in real time
  // instead of waiting for the next /account refetch (1s throttle).
  const calculatePnl = (position: Position) => {
    const pnl = computeUnrealizedPnl({
      side: position.side,
      entryPrice: parseFloat(position.entry_price),
      size: parseFloat(position.size),
      markPrice: getMarkPrice(position),
    })
    const roe = computeRoePercent(pnl, parseFloat(position.margin))
    return { pnl, roe }
  }

  const formatPnL = (position: Position, quoteCurrency: string) => {
    const { pnl, roe } = calculatePnl(position)
    const isNegative = pnl < 0
    return {
      value: `${isNegative ? "-" : ""}${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${quoteCurrency}`,
      percentage: `(${roe.toFixed(2)}%)`,
      isNegative,
    }
  }

  const formatFunding = (fundingPnl: string, quoteCurrency: string) => {
    const funding = parseFloat(fundingPnl)
    // Funding settlements are tiny (cents on small positions). 2 dp rounded
    // genuine settlements like -0.009 to "0.00", hiding the fact that funding
    // ran at all. 4 dp keeps small values visible without crowding bigger ones.
    return {
      value: `${Math.abs(funding).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${quoteCurrency}`,
      isPositive: funding >= 0,
    }
  }

  return (
    <div className="h-full overflow-x-scroll p-0">
      {positions.length === 0 ? (
        <div className="h-full p-3">
          <div className="text-sm text-muted-foreground">No positions yet.</div>
        </div>
      ) : (
        <table
          data-testid="positions-table"
          className="w-full text-xs font-light whitespace-nowrap text-foreground"
          cellSpacing={0}
          cellPadding={0}
        >
          <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
            <tr>
              <th className="h-8 px-2 text-left font-light text-muted-foreground w-[110px]">
                Market
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Position
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Size
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Position Value
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Entry Price
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Mark Price
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Liq. Price
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Unrealized PnL
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Margin
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Funding
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                TP / SL
              </th>
              <th className="sticky right-0 z-20 h-8 bg-card px-1 text-center font-light text-muted-foreground" />
            </tr>
          </thead>
          <tbody>
            {positions.map((position, index) => {
              const quoteCurrency = getQuoteCurrency(position)
              const pnl = formatPnL(position, quoteCurrency)
              const funding = formatFunding(position.funding_pnl, quoteCurrency)
              const markPrice = getMarkPrice(position)
              const positionValue = calculatePositionValue(position)
              const isClosing = closingMarkets[position.market] != null

              return (
                <tr
                  key={position.id}
                  data-index={index}
                  data-testid={`row-${index}`}
                  className={`h-8 border-b border-border bg-card ${index === 0 ? "border-t border-t-border" : ""}`}
                >
                  <td className="px-2 font-medium">
                    <div className="flex items-center gap-1">
                      <div
                        data-testid={`direction-${position.side.toLowerCase()}`}
                        className={`h-5 w-0.5 ${position.side === "Long" ? "bg-success" : "bg-destructive"}`}
                      />
                      <span>{getMarketSymbol(position.market)}</span>
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground cursor-default">
                              {getUserLeverage(position)}x
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            {getActualLeverage(position)}x | Max{" "}
                            {getUserLeverage(position)}x
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </td>
                  <td className="px-2">
                    <span
                      className={
                        position.side === "Long"
                          ? "text-success"
                          : "text-destructive"
                      }
                    >
                      {position.side}
                    </span>
                  </td>
                  <td className="px-2">{formatNumber(position.size)}</td>
                  <td className="px-2">
                    {positionValue.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    {getQuoteCurrency(position)}
                  </td>
                  <td className="px-2">
                    {parseFloat(position.entry_price).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-2">{formatNumber(markPrice)}</td>
                  <td className="px-2">
                    {positionLiquidationPrice(position) > 0
                      ? positionLiquidationPrice(position).toLocaleString(
                          "en-US",
                          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        )
                      : "N/A"}
                  </td>
                  <td className="px-2">
                    <div
                      className={`flex items-center gap-0.5 whitespace-nowrap ${pnl.isNegative ? "text-destructive" : "text-success"}`}
                    >
                      {pnl.value} {pnl.percentage}
                    </div>
                  </td>
                  <td className="px-2">
                    <div className="flex items-center gap-1">
                      {parseFloat(position.margin).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {quoteCurrency}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleModifyMargin(position)}
                      >
                        <Edit className="size-3" />
                      </Button>
                    </div>
                  </td>
                  <td className="px-2">
                    <div
                      className={`whitespace-nowrap ${funding.isPositive ? "text-success" : "text-destructive"}`}
                    >
                      {funding.isPositive ? "" : "-"}
                      {funding.value}
                    </div>
                  </td>
                  <td className="px-2">
                    <div className="flex items-center gap-1">
                      <p className="tracking-compact">__ / __</p>
                      <Button
                        data-testid="modify-sltp-button"
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0.5 border border-border hover:bg-muted"
                        disabled
                      >
                        <Edit className="size-3" />
                      </Button>
                    </div>
                  </td>
                  <td className="sticky right-0 z-10 bg-card px-1 text-center">
                    {isClosing ? (
                      // Close order accepted, fill settling — replaces the X
                      // so a second (conflicting) close can't be fired.
                      <span className="animate-pulse whitespace-nowrap px-1 text-[10px] text-warning">
                        Closing…
                      </span>
                    ) : (
                      <Button
                        data-testid="close-position-button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClosePosition(position)}
                        className="h-6 w-6 p-1 border border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20"
                        aria-label="Close Position"
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Modify Margin Modal */}
      <ModifyMarginModal
        position={marginPosition}
        open={isMarginModalOpen}
        onOpenChange={setIsMarginModalOpen}
      />
    </div>
  )
}
