"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

/**
 * TODO: Trade aggregation is currently done client-side by grouping on order_id.
 * This should be moved to the backend API (e.g. GET /perp/trades/mine?aggregate=true)
 * so pagination and filtering work correctly on aggregated results.
 * Current frontend-only approach has limitations:
 *  - Only aggregates within the fetched page of trades
 *  - Trades from the same order split across pages won't be grouped
 */

import type { Trade, TradeAction, TradeRole } from "@/types"
import { useMarketStore } from "@/lib/stores"
import { useAccountIndex } from "@/lib/hooks/useAccount"
import { formatNumber, formatDate, getAssetName } from "@/lib/utils"
import { MARGIN_TICK } from "@/lib/constants/scaling"

interface TradeHistoryTabProps {
  trades: Trade[]
  isAggregated: boolean
}

interface AggregatedTrade {
  orderId: number
  market: string
  action: TradeAction
  isLongSide: boolean
  totalSize: number
  avgPrice: number
  totalUsdAmount: number
  totalFee: number
  closedPnl: { pnl: number; pnlPercent: number } | null
  role: string
  createdAt: string
  tradeCount: number
  tradeType: string
}

// First column 110px: fits the longest market label ("USDKRW-USDT") without
// bleeding into Side — 80px was sized for "BTC-EL"-class names.
const GRID_COLS =
  "grid-cols-[110px_90px_1fr_1fr_1fr_1fr_minmax(120px,1.5fr)_1fr_1fr_1fr]"

function formatUsd(value: number): string {
  return Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function getMarketSymbol(market: string) {
  return marketDisplayLabel(market)
}

function getTradeAction(
  positionSizeBefore: number,
  isBuy: boolean
): TradeAction {
  const isLong = positionSizeBefore > 0
  const isClose = positionSizeBefore !== 0 && isLong !== isBuy

  if (isClose) {
    return isLong ? "Close Long" : "Close Short"
  }
  return isBuy ? "Open Long" : "Open Short"
}

function getUserRole(trade: Trade, accountIndex: number | null): TradeRole {
  if (accountIndex == null) return "maker"
  if (trade.maker_account_id != null && accountIndex === trade.maker_account_id)
    return "maker"
  if (trade.taker_account_id != null && accountIndex === trade.taker_account_id)
    return "taker"
  return "maker"
}

function getUserFields(trade: Trade, accountIndex: number | null) {
  const isMaker = getUserRole(trade, accountIndex) === "maker"

  return {
    isBuy: isMaker ? !trade.is_maker_ask : trade.is_maker_ask,
    positionSizeBefore: parseFloat(
      isMaker
        ? trade.maker_position_size_before
        : trade.taker_position_size_before
    ),
    entryQuoteBefore: parseFloat(
      isMaker ? trade.maker_entry_quote_before : trade.taker_entry_quote_before
    ),
    marginFraction: isMaker
      ? trade.maker_initial_margin_fraction_before
      : trade.taker_initial_margin_fraction_before,
    fee: parseFloat(isMaker ? trade.maker_fee : trade.taker_fee),
    role: isMaker ? "Maker" : "Taker",
    orderId: isMaker ? trade.maker_order_id : trade.taker_order_id,
  }
}

function getTradeInfo(trade: Trade, accountIndex: number | null) {
  const {
    isBuy,
    positionSizeBefore,
    entryQuoteBefore,
    marginFraction,
    fee,
    role,
  } = getUserFields(trade, accountIndex)
  const tradeSize = parseFloat(trade.size)
  const action = getTradeAction(positionSizeBefore, isBuy)
  const isLongSide = action.includes("Long")

  // Closed PnL (only for close actions)
  let closedPnl: { pnl: number; pnlPercent: number } | null = null
  if (action.startsWith("Close") && entryQuoteBefore > 0) {
    const absPositionBefore = Math.abs(positionSizeBefore)
    const closeSize = Math.min(tradeSize, absPositionBefore)
    const proportionalEntry = entryQuoteBefore * (closeSize / absPositionBefore)
    const exitValue = parseFloat(trade.price) * closeSize

    const pnl = isLongSide
      ? exitValue - proportionalEntry
      : proportionalEntry - exitValue
    const margin = proportionalEntry * (marginFraction / MARGIN_TICK)
    const pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0

    closedPnl = { pnl, pnlPercent }
  }

  return { isLongSide, action, fee, closedPnl, role }
}

function aggregateTrades(
  trades: Trade[],
  accountIndex: number | null
): AggregatedTrade[] {
  const groups = new Map<number, Trade[]>()

  for (const trade of trades) {
    const { orderId } = getUserFields(trade, accountIndex)
    const existing = groups.get(orderId)
    if (existing) {
      existing.push(trade)
    } else {
      groups.set(orderId, [trade])
    }
  }

  const result: AggregatedTrade[] = []

  for (const [orderIdKey, group] of groups) {
    const first = group[0]
    const firstFields = getUserFields(first, accountIndex)
    const firstInfo = getTradeInfo(first, accountIndex)

    let totalSize = 0
    let totalUsdAmount = 0
    let totalFee = 0
    let totalPnl = 0
    let totalMargin = 0
    let hasPnl = false

    for (const trade of group) {
      const size = parseFloat(trade.size)
      const usd = parseFloat(trade.usd_amount)
      const fields = getUserFields(trade, accountIndex)
      const info = getTradeInfo(trade, accountIndex)

      totalSize += size
      totalUsdAmount += usd
      totalFee += fields.fee

      if (info.closedPnl) {
        hasPnl = true
        totalPnl += info.closedPnl.pnl
        // Approximate margin for percent calc
        const entryQuote = parseFloat(
          fields.role === "Maker"
            ? trade.maker_entry_quote_before
            : trade.taker_entry_quote_before
        )
        const marginFrac =
          fields.role === "Maker"
            ? trade.maker_initial_margin_fraction_before
            : trade.taker_initial_margin_fraction_before
        const posSize = Math.abs(
          parseFloat(
            fields.role === "Maker"
              ? trade.maker_position_size_before
              : trade.taker_position_size_before
          )
        )
        const closeSize = Math.min(size, posSize)
        const proportionalEntry =
          posSize > 0 ? entryQuote * (closeSize / posSize) : 0
        totalMargin += proportionalEntry * (marginFrac / MARGIN_TICK)
      }
    }

    const avgPrice = totalSize > 0 ? totalUsdAmount / totalSize : 0

    result.push({
      orderId: orderIdKey,
      market: first.market,
      action: firstInfo.action,
      isLongSide: firstInfo.isLongSide,
      totalSize,
      avgPrice,
      totalUsdAmount,
      totalFee,
      closedPnl: hasPnl
        ? {
            pnl: totalPnl,
            pnlPercent: totalMargin > 0 ? (totalPnl / totalMargin) * 100 : 0,
          }
        : null,
      role: firstFields.role,
      createdAt: first.created_at,
      tradeCount: group.length,
      tradeType: first.trade_type,
    })
  }

  return result
}

export function TradeHistoryTab({
  trades,
  isAggregated,
}: TradeHistoryTabProps) {
  const accountIndex = useAccountIndex()
  const pairs = useMarketStore((s) => s.pairs)

  // Trade value / PnL / fee are denominated in the market's quote token
  // (multi-token, ELP-133): EL$ for BTC-PERP, USDT for BTC-PERP-USDT.
  const quoteSymbolFor = (market: string) => {
    const pair = pairs.find((p) => p.name === market)
    return pair ? getAssetName(pair.quote_currency) : "EL$"
  }

  const aggregated = isAggregated ? aggregateTrades(trades, accountIndex) : null

  return (
    <div className="h-full overflow-x-scroll p-0">
      {trades.length === 0 ? (
        <div className="h-full p-3">
          <div className="text-sm text-muted-foreground">No trade history.</div>
        </div>
      ) : (
        <div className="relative w-full">
          <table
            data-testid="trade-history-table"
            className="relative z-0 grid w-full bg-card text-xs font-light whitespace-nowrap text-foreground"
          >
            <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
              <tr className={`grid w-full ${GRID_COLS} px-2`}>
                <th className="flex h-8 min-w-[110px] items-center font-light text-muted-foreground text-xs">
                  Market
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Side
                </th>
                <th className="flex h-8 min-w-[150px] items-center font-light text-muted-foreground text-xs">
                  Date
                </th>
                <th className="flex h-8 min-w-[135px] items-center font-light text-muted-foreground text-xs">
                  Trade Value
                </th>
                <th className="flex h-8 min-w-[95px] items-center font-light text-muted-foreground text-xs">
                  Size
                </th>
                <th className="flex h-8 min-w-[105px] items-center font-light text-muted-foreground text-xs">
                  {isAggregated ? "Avg Price" : "Price"}
                </th>
                <th className="flex h-8 min-w-[150px] items-center font-light text-muted-foreground text-xs">
                  Closed PnL
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Fee
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Role
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Type
                </th>
              </tr>
            </thead>
            <tbody className="relative">
              {isAggregated && aggregated
                ? aggregated.map((agg, index) => {
                    const sideColor = agg.isLongSide
                      ? "text-success"
                      : "text-destructive"
                    const quote = quoteSymbolFor(agg.market)

                    return (
                      <tr
                        key={agg.orderId}
                        data-index={index}
                        className={`grid w-full ${GRID_COLS} items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs`}
                      >
                        <td className="flex min-w-[110px] items-center gap-1 font-medium">
                          <div className="flex h-full items-center gap-1 font-medium max-md:h-8">
                            <div
                              className={`h-5 w-0.5 max-md:h-full ${agg.isLongSide ? "bg-success" : "bg-destructive"}`}
                            ></div>
                            <span>{getMarketSymbol(agg.market)}</span>
                          </div>
                        </td>
                        <td className="flex min-w-[90px]">
                          <span className={sideColor}>{agg.action}</span>
                        </td>
                        <td className="flex min-w-[150px]">
                          {formatDate(agg.createdAt)}
                        </td>
                        <td className="flex min-w-[135px]">
                          {formatNumber(agg.totalUsdAmount)} {quote}
                        </td>
                        <td className="flex min-w-[95px]">
                          {formatNumber(agg.totalSize)}
                        </td>
                        <td className="flex min-w-[105px]">
                          {formatNumber(agg.avgPrice)}
                        </td>
                        <td className="flex min-w-[150px]">
                          {agg.closedPnl ? (
                            <div
                              className={`flex items-center gap-0.5 whitespace-nowrap ${agg.closedPnl.pnl < 0 ? "text-destructive" : "text-success"}`}
                            >
                              <span>
                                {agg.closedPnl.pnl < 0 ? "-" : ""}
                                {formatUsd(agg.closedPnl.pnl)} {quote}
                              </span>
                              <span>
                                ({agg.closedPnl.pnlPercent >= 0 ? "+" : ""}
                                {agg.closedPnl.pnlPercent.toFixed(2)}%)
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="flex min-w-[80px]">
                          {formatUsd(agg.totalFee)} {quote}
                        </td>
                        <td className="flex min-w-[80px]">{agg.role}</td>
                        <td className="flex min-w-[80px]">
                          <span className="capitalize">{agg.tradeType}</span>
                        </td>
                      </tr>
                    )
                  })
                : trades.map((trade, index) => {
                    const { isLongSide, action, fee, closedPnl, role } =
                      getTradeInfo(trade, accountIndex)
                    const sideColor = isLongSide
                      ? "text-success"
                      : "text-destructive"
                    const quote = quoteSymbolFor(trade.market)

                    return (
                      <tr
                        key={trade.id}
                        data-index={index}
                        data-testid={`row-${index}`}
                        className={`grid w-full ${GRID_COLS} items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs`}
                      >
                        <td
                          data-testid={`row-${index}-cell-0_market.symbol`}
                          className="flex min-w-[80px] items-center gap-1 font-medium"
                        >
                          <div className="flex h-full items-center gap-1 font-medium max-md:h-8">
                            <div
                              data-testid={`direction-${isLongSide ? "long" : "short"}`}
                              className={`h-5 w-0.5 max-md:h-full ${isLongSide ? "bg-success" : "bg-destructive"}`}
                            ></div>
                            <span>{getMarketSymbol(trade.market)}</span>
                            <div className="invisible w-2.5"></div>
                          </div>
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_sideDisplayText`}
                          className="flex min-w-[90px]"
                        >
                          <span className={sideColor}>{action}</span>
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_trade.timestamp`}
                          className="flex min-w-[150px]"
                        >
                          {formatDate(trade.created_at)}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_sizeUsd`}
                          className="flex min-w-[135px]"
                        >
                          {formatNumber(trade.usd_amount)} {quote}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_sizeCoin`}
                          className="flex min-w-[95px]"
                        >
                          {formatNumber(trade.size)}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_price`}
                          className="flex min-w-[105px]"
                        >
                          {formatNumber(trade.price)}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_closedPnl`}
                          className="flex min-w-[150px]"
                        >
                          {closedPnl ? (
                            <div
                              className={`flex items-center gap-0.5 whitespace-nowrap ${closedPnl.pnl < 0 ? "text-destructive" : "text-success"}`}
                            >
                              <span>
                                {closedPnl.pnl < 0 ? "-" : ""}
                                {formatUsd(closedPnl.pnl)} {quote}
                              </span>
                              <span>
                                ({closedPnl.pnlPercent >= 0 ? "+" : ""}
                                {closedPnl.pnlPercent.toFixed(2)}%)
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_fee`}
                          className="flex min-w-[80px]"
                        >
                          {formatUsd(fee)} {quote}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_role`}
                          className="flex min-w-[80px]"
                        >
                          {role}
                        </td>
                        <td
                          data-testid={`row-${index}-cell-0_type`}
                          className="flex min-w-[80px]"
                        >
                          <span className="capitalize">{trade.trade_type}</span>
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
