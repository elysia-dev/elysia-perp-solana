"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { Button } from "@/components/ui/button"
import { Edit, X } from "lucide-react"
import { formatNumber, formatDate } from "@/lib/utils"
import { useMarkPriceStore } from "@/lib/stores"
import type { PerpOrder } from "@/types"

interface PerpOpenOrdersTabProps {
  orders: PerpOrder[]
  onCancelOrder: (order: PerpOrder) => void
  isPending: boolean
}

export function PerpOpenOrdersTab({
  orders,
  onCancelOrder,
  isPending,
}: PerpOpenOrdersTabProps) {
  const markPrices = useMarkPriceStore((s) => s.markPrices)
  const getMarketSymbol = (market: string) => marketDisplayLabel(market)
  const getSideColor = (side: string) =>
    side === "Long" ? "text-success" : "text-destructive"
  const getMarkPrice = (market: string) => {
    const priceData = markPrices?.get(market)
    return priceData ? formatNumber(priceData.mark_price) : "-"
  }

  return (
    <div className="h-full overflow-x-auto p-0">
      {orders.length === 0 ? (
        <div className="h-full p-3">
          <div className="text-sm text-muted-foreground">No open orders.</div>
        </div>
      ) : (
        <table
          data-testid="perp-open-orders-table"
          className="w-full text-xs font-light whitespace-nowrap text-foreground"
          cellSpacing={0}
          cellPadding={0}
        >
          <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
            <tr>
              <th className="h-8 px-2 text-left font-light text-muted-foreground w-[110px]">
                Market
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground w-[90px]">
                Side
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Date
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Type
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Amount
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Filled
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Price
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Mark Price
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Reduce Only
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Trigger Conditions
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                Expires in
              </th>
              <th className="h-8 px-2 text-left font-light text-muted-foreground">
                TP / SL
              </th>
              <th className="sticky right-0 z-20 h-8 bg-card px-1 text-center font-light text-muted-foreground" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order, index) => (
              <tr
                key={order.id}
                data-index={index}
                data-testid={`row-${index}`}
                className={`h-8 border-b border-border bg-card ${index === 0 ? "border-t border-t-border" : ""}`}
              >
                <td className="px-2 font-medium">
                  <div className="flex items-center gap-1">
                    <div
                      className={`h-5 w-0.5 ${order.side === "Long" ? "bg-success" : "bg-destructive"}`}
                    />
                    <span>{getMarketSymbol(order.market)}</span>
                  </div>
                </td>
                <td className={`px-2 ${getSideColor(order.side)}`}>
                  {order.side}
                </td>
                <td className="px-2">
                  {order.created_at ? formatDate(order.created_at) : "-"}
                </td>
                <td className="px-2">{order.order_type}</td>
                <td className="px-2">
                  {formatNumber(order.initial_base_amount)}
                </td>
                <td className="px-2">
                  {parseFloat(order.filled_base_amount) === 0
                    ? "-"
                    : formatNumber(order.filled_base_amount)}
                </td>
                <td className="px-2">{formatNumber(order.price)}</td>
                <td className="px-2">{getMarkPrice(order.market)}</td>
                <td className="px-2">{order.reduce_only ? "Yes" : "No"}</td>
                <td className="px-2">-</td>
                <td className="px-2">-</td>
                <td className="px-2">
                  <span className="inline-flex items-center gap-1">
                    - / -
                    <Button
                      data-testid="modify-order-button"
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0.5 border border-border hover:bg-muted"
                      disabled
                    >
                      <Edit className="size-3" />
                    </Button>
                  </span>
                </td>
                <td className="sticky right-0 z-10 bg-card px-1 text-center">
                  <Button
                    data-testid="cancel-order-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancelOrder(order)}
                    disabled={isPending}
                    className="h-6 w-6 p-1 border border-destructive text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
