"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { useMemo } from "react"
import { useFundingHistory } from "@/lib/hooks/useFundingHistory"
import { useMarketStore } from "@/lib/stores"
import { formatNumber, formatDate, getAssetName } from "@/lib/utils"
import type { PerpSideFilter } from "@/types/history"

export function FundingHistoryTab({
  sideFilter = "all",
}: {
  sideFilter?: PerpSideFilter
}) {
  const { data, isLoading } = useFundingHistory()
  const pairs = useMarketStore((s) => s.pairs)
  // Funding is paid in the market's quote token (multi-token, ELP-133).
  const quoteSymbolFor = (market: string) => {
    const pair = pairs.find((p) => p.name === market)
    return pair ? getAssetName(pair.quote_currency) : "EL$"
  }
  const payments = useMemo(() => {
    const all = data?.funding_payments ?? []
    if (sideFilter === "all") return all
    return all.filter(
      (p) => p.position_side?.toLowerCase() === sideFilter.toLowerCase()
    )
  }, [data, sideFilter])

  if (isLoading) {
    return (
      <div className="h-full p-3">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (payments.length === 0) {
    return (
      <div className="h-full p-3">
        <div className="text-sm text-muted-foreground">No funding history.</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-x-scroll p-0">
      <div className="relative w-full">
        <table className="relative z-0 grid w-full bg-card text-xs font-light whitespace-nowrap text-foreground">
          <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
            <tr className="grid w-full grid-cols-[110px_90px_1fr_1fr_1fr_1fr] px-2">
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Market
              </th>
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Side
              </th>
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Date
              </th>
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Position Size
              </th>
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Payment
              </th>
              <th className="flex h-8 items-center font-light text-muted-foreground text-xs">
                Rate
              </th>
            </tr>
          </thead>
          <tbody className="relative">
            {payments.map((payment) => {
              const paymentNum = parseFloat(payment.payment)
              const isPositive = paymentNum >= 0
              return (
                <tr
                  key={payment.id}
                  className="grid w-full grid-cols-[110px_90px_1fr_1fr_1fr_1fr] items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs"
                >
                  <td className="flex min-w-[70px] items-center gap-1 font-medium">
                    <div className="flex h-full items-center gap-1 font-medium">
                      <div
                        className={`h-5 w-0.5 ${payment.position_side?.toLowerCase() === "long" ? "bg-success" : "bg-destructive"}`}
                      />
                      <span>{marketDisplayLabel(payment.market)}</span>
                    </div>
                  </td>
                  <td
                    className={`flex ${payment.position_side?.toLowerCase() === "long" ? "text-success" : "text-destructive"}`}
                  >
                    {payment.position_side}
                  </td>
                  <td className="flex">
                    {payment.created_at ? formatDate(payment.created_at) : "-"}
                  </td>
                  <td className="flex">
                    {formatNumber(payment.position_size)}
                  </td>
                  <td
                    className={`flex ${isPositive ? "text-success" : "text-destructive"}`}
                  >
                    {isPositive ? "+" : ""}
                    {formatNumber(payment.payment)}{" "}
                    {quoteSymbolFor(payment.market)}
                  </td>
                  <td className="flex">
                    {/* Backend ships funding rate as a fraction
                       (rate_ticks / FUNDING_RATE_TICK). Convert to percent
                       to match the units used in MarketStats (useMarkPriceSync
                       already does *100 there). */}
                    {(parseFloat(payment.rate) * 100).toFixed(4)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
