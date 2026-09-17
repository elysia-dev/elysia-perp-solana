"use client"

import Image from "next/image"
import { useBalance } from "@/lib/hooks/useBalance"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useMarkPriceStore } from "@/lib/stores/useMarkPriceStore"
import { resolveLiveMarkPrice } from "@/lib/utils/markPrice"
import { computeUnrealizedPnl } from "@/lib/utils/pnl"
import { getAssetName, formatNumber } from "@/lib/utils"
import { getAssetIcon } from "@/lib/constants/assets"
import type { Position } from "@/types"

export function AssetsTab() {
  const { data: balance } = useBalance()
  const positions = usePositionsList()
  // Live mark prices — re-derives unrealized PnL on every WS tick so the
  // displayed equity moves with the market instead of lagging /account.
  const markPrices = useMarkPriceStore((s) => s.markPrices)

  const getLiveMarkPrice = (p: Position): number =>
    resolveLiveMarkPrice(markPrices, p.market, p.mark_price)

  const liveUnrealizedPnl = (p: Position): number =>
    computeUnrealizedPnl({
      side: p.side,
      entryPrice: parseFloat(p.entry_price),
      size: parseFloat(p.size),
      markPrice: getLiveMarkPrice(p),
    })

  // Per-token equity (multi-token, ELP-133): Available + open-position Margin +
  // Unrealized PnL + Funding Fee, counting only positions quoted in that token.
  // Positions carry their server-authoritative quote_asset_id directly.
  const openPositions = positions.filter((p) => parseFloat(p.size) !== 0)

  const tokenTotalBalance = (assetId: number, available: number): number => {
    const tokenPositions = openPositions.filter(
      (p) => p.quote_asset_id === assetId
    )
    const margin = tokenPositions.reduce((s, p) => s + parseFloat(p.margin), 0)
    const pnl = tokenPositions.reduce((s, p) => s + liveUnrealizedPnl(p), 0)
    const funding = tokenPositions.reduce(
      (s, p) => s + parseFloat(p.funding_pnl),
      0
    )
    return available + margin + pnl + funding
  }

  return (
    <div className="h-full overflow-x-scroll p-0">
      {!balance?.balances || balance.balances.length === 0 ? (
        <div className="h-full p-3">
          <div className="text-sm text-muted-foreground">
            No assets to display.
          </div>
        </div>
      ) : (
        <div className="relative w-full">
          <table
            data-testid="assets-table"
            className="relative z-0 grid w-full bg-card text-xs font-light whitespace-nowrap text-foreground"
          >
            <thead className="sticky top-0 z-10 bg-card backdrop-blur-xl">
              <tr className="grid w-full grid-cols-[minmax(120px,1fr)_minmax(150px,1fr)_minmax(200px,1fr)_minmax(150px,1fr)] px-2">
                <th className="flex h-8 min-w-[120px] items-center font-light text-muted-foreground text-xs">
                  Asset
                </th>
                <th className="flex h-8 min-w-[150px] items-center font-light text-muted-foreground text-xs">
                  Total Balance
                </th>
                <th className="flex h-8 min-w-[200px] items-center font-light text-muted-foreground text-xs">
                  Available Balance
                </th>
                <th className="flex h-8 min-w-[150px] items-center font-light text-muted-foreground text-xs">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="relative">
              {balance.balances.map((asset, index) => {
                const assetName = getAssetName(asset.asset_id)
                const available = parseFloat(asset.available)
                const totalBalance = tokenTotalBalance(
                  asset.asset_id,
                  available
                )

                return (
                  <tr
                    key={`${asset.asset_id}-${asset.route_type}`}
                    data-index={index}
                    data-testid={`row-${index}`}
                    className="grid w-full grid-cols-[minmax(120px,1fr)_minmax(150px,1fr)_minmax(200px,1fr)_minmax(150px,1fr)] items-center bg-card border-b border-border first:border-t first:border-t-border h-8 px-2 text-xs group cursor-pointer hover:bg-muted"
                  >
                    <td
                      data-testid={`row-${index}-cell-0_asset.symbol`}
                      className="flex min-w-[120px] items-center gap-2 font-medium"
                    >
                      <div className="flex h-full items-center gap-2 font-medium max-md:h-8">
                        <div className="h-5 w-0.5 bg-foreground shadow-white-horizontal max-md:h-full"></div>
                        <span className="flex shrink-0 items-center justify-center size-5">
                          <Image
                            src={getAssetIcon(asset.asset_id)}
                            alt={assetName}
                            width={20}
                            height={20}
                          />
                        </span>
                        <span className="text-xs">
                          <span className="text-foreground">{assetName}</span>
                          <span className="text-foreground"> / </span>
                          <span className="text-muted-foreground">
                            {asset.route_type}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_balance`}
                      className="flex min-w-[150px]"
                    >
                      <span>
                        {formatNumber(totalBalance)} {assetName}
                      </span>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_availableBalance`}
                      className="flex min-w-[200px]"
                    >
                      <span>
                        {formatNumber(available)} {assetName}
                      </span>
                    </td>
                    <td
                      data-testid={`row-${index}-cell-0_sizeUsd`}
                      className="flex min-w-[150px]"
                    >
                      ${formatNumber(totalBalance)}
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
