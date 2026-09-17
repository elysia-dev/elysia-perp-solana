"use client"

import type { Order } from "@/types"
import { formatNumber, formatDate, getAssetName } from "@/lib/utils"
import type { Market } from "@/types"

interface OrderHistoryTabProps {
  orders: Order[]
  marketMap: Map<string, Market>
}

export function OrderHistoryTab({ orders, marketMap }: OrderHistoryTabProps) {
  const getMarketSymbol = (marketId: string) => {
    const market = marketMap.get(marketId)
    if (!market) return marketId
    return getAssetName(market.base_currency)
  }

  return (
    <div className="h-full overflow-x-scroll p-0">
      {orders.length === 0 ? (
        <div className="flex h-full items-center justify-center p-3">
          <div className="text-sm text-muted-foreground">No order history.</div>
        </div>
      ) : (
        <div className="relative w-full">
          <table
            data-testid="order-history-table"
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
                <th className="flex h-8 min-w-[150px] items-center font-light text-muted-foreground text-xs">
                  Date
                </th>
                <th className="flex h-8 min-w-[80px] items-center font-light text-muted-foreground text-xs">
                  Type
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Amount
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Filled
                </th>
                <th className="flex h-8 min-w-[100px] items-center font-light text-muted-foreground text-xs">
                  Price
                </th>
                <th className="flex h-8 min-w-[100px] items-center font-light text-muted-foreground text-xs">
                  Average
                </th>
                <th className="flex h-8 min-w-[90px] items-center font-light text-muted-foreground text-xs">
                  Reduce Only
                </th>
                <th className="flex h-8 min-w-[100px] items-center font-light text-muted-foreground text-xs">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="relative">
              {orders.map((order, index) => {
                const isFilled =
                  parseFloat(order.filled_base_amount) > 0 &&
                  parseFloat(order.filled_base_amount) >=
                    parseFloat(order.initial_base_amount)
                const sideDisplay = order.side === "bid" ? "Long" : "Short"
                const sideColor =
                  order.side === "bid" ? "text-success" : "text-destructive"
                const status = isFilled ? "Filled" : order.status || "Open"

                return (
                  <tr
                    key={order.id}
                    data-index={index}
                    data-testid={`row-${index}`}
                    className="grid w-full grid-cols-[110px_90px_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs"
                  >
                    <td
                      data-testid={`row-${index}-cell-0_market.symbol`}
                      className="flex min-w-[110px] items-center gap-1 font-medium"
                    >
                      <div className="flex h-full items-center gap-1 font-medium max-md:h-8">
                        <div
                          data-testid="direction-short"
                          className={`h-5 w-0.5 max-md:h-full ${order.side === "bid" ? "bg-success" : "bg-destructive"}`}
                        ></div>
                        <span>{getMarketSymbol(order.market)}</span>
                        <div className="invisible w-2.5"></div>
                      </div>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_sideDisplayText`}
                      className={`flex min-w-[60px] ${sideColor}`}
                    >
                      <span>{sideDisplay}</span>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_order.updated_at`}
                      className="flex min-w-[150px]"
                    >
                      {formatDate(order.created_at)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_type`}
                      className="flex min-w-[80px]"
                    >
                      Limit
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_amount`}
                      className="flex min-w-[90px]"
                    >
                      {formatNumber(order.initial_base_amount)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_filled`}
                      className="flex min-w-[90px]"
                    >
                      {parseFloat(order.filled_base_amount) === 0
                        ? "-"
                        : formatNumber(order.filled_base_amount)}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_price`}
                      className="flex min-w-[100px]"
                    >
                      {order.price ? formatNumber(order.price) : "-"}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_average`}
                      className="flex min-w-[100px]"
                    >
                      {parseFloat(order.filled_base_amount) > 0
                        ? formatNumber(order.price)
                        : "-"}
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_reduce_only`}
                      className="flex min-w-[90px]"
                    >
                      No
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_status`}
                      className="flex min-w-[100px]"
                    >
                      <div className="flex gap-1">
                        <p className="text-foreground">{status}</p>
                      </div>
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
