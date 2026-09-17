"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { Info } from "lucide-react"
import { formatNumber, formatDate } from "@/lib/utils"
import type { PerpOrder } from "@/types"

interface PerpOrderHistoryTabProps {
  orders: PerpOrder[]
}

export function PerpOrderHistoryTab({ orders }: PerpOrderHistoryTabProps) {
  const getMarketSymbol = (market: string) => {
    return marketDisplayLabel(market)
  }

  const getSideColor = (side: string) => {
    return side === "Long" ? "text-success" : "text-destructive"
  }

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "filled":
        return { text: "Filled", color: "text-foreground", showIcon: false }
      case "cancelled":
        return {
          text: "Canceled",
          color: "text-muted-foreground",
          showIcon: true,
        }
      case "partial":
        return { text: "Partial", color: "text-warning", showIcon: false }
      case "placed":
        return { text: "Open", color: "text-foreground", showIcon: false }
      default:
        return { text: status, color: "text-foreground", showIcon: false }
    }
  }

  const calculateAverage = (order: PerpOrder) => {
    // If the order has been filled (partially or fully), show average price
    // For now, we use the order price as average since API doesn't provide average fill price
    if (parseFloat(order.filled_base_amount) > 0) {
      return formatNumber(order.price)
    }
    return "-"
  }

  return (
    <div className="h-full overflow-x-scroll p-0">
      {orders.length === 0 ? (
        <div className="h-full p-3">
          <div className="text-sm text-muted-foreground">No order history.</div>
        </div>
      ) : (
        <div className="relative w-full">
          <table
            data-testid="perp-order-history-table"
            className="relative z-0 grid w-full bg-card text-xs font-light whitespace-nowrap text-foreground"
          >
            <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
              <tr className="grid w-full grid-cols-[110px_90px_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] px-2">
                <th className="flex h-8 min-w-[110px] items-center font-light text-muted-foreground text-xs">
                  Market
                </th>
                <th className="flex h-8 min-w-[60px] items-center font-light text-muted-foreground text-xs">
                  Side
                </th>
                <th className="flex h-8 min-w-[140px] items-center font-light text-muted-foreground text-xs">
                  Date
                </th>
                <th className="flex h-8 min-w-[70px] items-center font-light text-muted-foreground text-xs">
                  Type
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Amount
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Filled
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Price
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Average
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Reduce Only
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="relative">
              {orders.map((order, index) => {
                const status = getStatusDisplay(order.status)

                return (
                  <tr
                    key={order.id}
                    data-index={index}
                    data-testid={`row-${index}`}
                    className="grid w-full grid-cols-[110px_90px_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs"
                  >
                    <td
                      data-testid={`row-${index}-cell-market`}
                      className="flex min-w-[110px] items-center gap-1 font-medium"
                    >
                      <div className="flex h-full items-center gap-1 font-medium max-md:h-8">
                        <div
                          className={`h-5 w-0.5 max-md:h-full ${order.side === "Long" ? "bg-success" : "bg-destructive"}`}
                        />
                        <span>{getMarketSymbol(order.market)}</span>
                      </div>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-side`}
                      className={`flex min-w-[60px] ${getSideColor(order.side)}`}
                    >
                      <span>{order.side}</span>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-date`}
                      className="flex min-w-[140px]"
                    >
                      {formatDate(order.created_at)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-type`}
                      className="flex min-w-[70px]"
                    >
                      {order.order_type}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-amount`}
                      className="flex min-w-[90px]"
                    >
                      {formatNumber(order.initial_base_amount)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-filled`}
                      className="flex min-w-[80px]"
                    >
                      {parseFloat(order.filled_base_amount) === 0
                        ? "-"
                        : formatNumber(order.filled_base_amount)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-price`}
                      className="flex min-w-[90px]"
                    >
                      {order.order_type === "Market"
                        ? "-"
                        : formatNumber(order.price)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-average`}
                      className="flex min-w-[90px]"
                    >
                      {calculateAverage(order)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-reduce-only`}
                      className="flex min-w-[80px]"
                    >
                      {order.reduce_only ? "Yes" : "No"}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-status`}
                      className={`flex min-w-[90px] items-center gap-1 ${status.color}`}
                    >
                      <span>{status.text}</span>
                      {status.showIcon && <Info className="size-3" />}
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
