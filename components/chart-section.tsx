"use client"

import { useState } from "react"
import Image from "next/image"
import { ChevronDown, ChevronUp, Info } from "lucide-react"
import { AdvancedChart } from "@/components/advanced-chart"
import { MarketStats } from "@/components/market-stats"
import { MarketSelectorDialog } from "@/components/trading/market-selector-dialog"
import { CollateralSelectorDialog } from "@/components/trading/collateral-selector-dialog"
import { EcosystemLogo } from "@/components/trading/ecosystem-logo"
import { OrderBook } from "@/components/order-book"
import { RecentTrades } from "@/components/recent-trades"
import { useSelectedPair } from "@/lib/stores"
import { useMarketMode } from "@/lib/hooks/useMarketMode"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import {
  useMarkPriceStore,
  selectMarkPriceData,
} from "@/lib/stores/useMarkPriceStore"
import { getEcosystemByQuoteAssetId } from "@/lib/config/markets"
import { formatPrice } from "@/lib/utils/format"
import { imfToLeverage, type OrderBookDetail } from "@/types"

type MobileTab = "chart" | "orderbook" | "trades"

const MOBILE_TABS: { value: MobileTab; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "orderbook", label: "Order Book" },
  { value: "trades", label: "Trades" },
]

export function ChartSection({
  label,
  dataSource = "ws",
}: {
  label?: string
  dataSource?: "ws" | "rest"
} = {}) {
  const pair = useSelectedPair()
  // Collateral chip follows the *selected market*, not the global ecosystem
  // browse filter. The two can diverge — e.g. user deep-links to
  // /trade/BTC-PERP-ARB while the ecosystem store still says "elysia" —
  // and when they do, the old code rendered "EL · Used as collateral"
  // on an ARB-quoted chart. Derive the ecosystem from the market's
  // server-authoritative `quote_currency` instead.
  const ecosystem = getEcosystemByQuoteAssetId(pair.quote_currency)
  // 휴장/halt 배지 — server team: WS market_mode "reduce_only" maps 1:1 to
  // the market's closed session, so it alone drives the closed-market UI
  // (no trading_hours parsing needed).
  const marketMode = useMarketMode(pair.id, pair.name)
  const { data: orderBookDetailsData } = useOrderBookDetails()
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart")
  const [statsExpanded, setStatsExpanded] = useState(false)
  const priceData = useMarkPriceStore(selectMarkPriceData(pair.name))
  const markPrice = priceData?.mark_price ? parseFloat(priceData.mark_price) : 0
  const dailyChange = priceData?.daily_change
    ? parseFloat(priceData.daily_change)
    : 0

  const detail = orderBookDetailsData?.order_book_details?.find(
    (d: OrderBookDetail) => d.symbol === pair.name
  )
  const maxLev = detail?.min_initial_margin_fraction
    ? Math.floor(imfToLeverage(detail.min_initial_margin_fraction))
    : null

  // Soft brand tint applied only to the header area
  const accent = `color-mix(in oklch, ${ecosystem.color} 55%, transparent)`
  const accentTint = `color-mix(in oklch, ${ecosystem.color} 8%, transparent)`

  return (
    <div className="relative flex flex-1 flex-col rounded-lg border border-border bg-card min-w-0">
      {/* Market-selector header — bordered top section with ecosystem accent */}
      <div
        className="flex flex-col gap-3 rounded-t-lg border-b-2 p-3 min-[851px]:flex-row min-[851px]:items-center min-[851px]:gap-2"
        style={{ borderBottomColor: accent, backgroundColor: accentTint }}
      >
        {label && (
          <span className="text-xs font-medium text-muted-foreground">
            ({label})
          </span>
        )}
        <div className="flex items-center gap-2 min-[851px]:contents">
          <MarketSelectorDialog
            trigger={
              <button
                type="button"
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 outline-none transition-colors hover:bg-muted/40"
              >
                <Image
                  src={`/icons/tokens/${pair.base.toLowerCase()}.svg`}
                  alt={pair.base}
                  width={20}
                  height={20}
                />
                {/* Display-only "BTC-USD" style label — prices are USD-quoted,
                    and the internal market name (BTC-PERP-EL) is a routing/
                    collateral detail. All server requests still key on
                    `pair.name`. */}
                <span className="text-base font-semibold">
                  {pair.base.toUpperCase()}-USD
                </span>
                {maxLev != null && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {maxLev}x
                  </span>
                )}
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            }
          />

          {/* Session-state badge, outside the selector trigger so it never
              reads as part of the market-picker affordance. */}
          {marketMode === "reduce_only" && (
            <span
              title="FX session closed — only reduce-only orders are accepted until the market reopens."
              className="shrink-0 cursor-default rounded border border-[#f5a623]/40 bg-[#f5a623]/10 px-1.5 py-0.5 text-xs font-medium text-[#f5a623]"
            >
              Market Closed
            </span>
          )}
          {marketMode === "halted" && (
            <span
              title="Trading is halted — waiting for a fresh oracle price. Only cancellations are accepted."
              className="shrink-0 cursor-default rounded border border-[#f15044]/40 bg-[#f15044]/10 px-1.5 py-0.5 text-xs font-medium text-[#f15044]"
            >
              Halted
            </span>
          )}

          {/* Collateral selector — desktop only, sits right after the market
              selector (Figma 2248-2501). Narrow screens render collateral
              inside the MarketStats grid instead. */}
          <div
            className="hidden shrink-0 flex-col min-[851px]:flex min-[851px]:border-l min-[851px]:pl-3"
            style={{ borderLeftColor: accent }}
          >
            <span className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground">
              Collateral
              <Info className="h-3 w-3" />
            </span>
            <CollateralSelectorDialog
              trigger={
                <button
                  type="button"
                  className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 outline-none transition-colors hover:bg-muted/40"
                >
                  <EcosystemLogo ecosystem={ecosystem} size={18} />
                  <span className="text-sm font-semibold">
                    {ecosystem.collateralToken}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              }
            />
          </div>

          {/* Inline price + change + toggle (narrow only) */}
          <div className="ml-auto flex items-center gap-2 min-[851px]:hidden">
            <span className="text-sm font-semibold tabular-nums">
              {formatPrice(markPrice)}
            </span>
            <span
              className={`text-xs font-medium tabular-nums ${
                dailyChange >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {dailyChange >= 0 ? "+" : ""}
              {dailyChange.toFixed(2)}%
            </span>
            <button
              type="button"
              onClick={() => setStatsExpanded((s) => !s)}
              aria-label={statsExpanded ? "Collapse stats" : "Expand stats"}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              {statsExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div
          className={`min-w-0 flex-1 min-[851px]:ml-2 min-[851px]:border-l min-[851px]:border-border min-[851px]:pl-3 ${
            statsExpanded ? "" : "max-[850px]:hidden"
          }`}
        >
          <MarketStats />
        </div>
      </div>

      {/* Mobile tabs (only visible on narrow screens) */}
      <div className="hidden border-b border-border max-[850px]:flex">
        {MOBILE_TABS.map((tab) => {
          const isActive = mobileTab === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setMobileTab(tab.value)}
              className={`relative h-9 flex-1 cursor-pointer px-3 text-xs font-medium transition-colors hover:text-foreground ${
                isActive ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {tab.label}
              <div
                className={`absolute inset-x-0 bottom-0 mx-auto h-0.5 w-3/5 max-w-16 rounded-full bg-primary transition-all duration-300 ${
                  isActive ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          )
        })}
      </div>

      {/* Content area: chart always rendered (hidden when other tab on mobile), orderbook/trades only on mobile */}
      <div className="relative min-h-0 min-w-0 flex-1">
        {/* Chart — always mounted; hidden on mobile when other tab selected */}
        <div
          className={`absolute inset-0 p-2 ${
            mobileTab !== "chart" ? "max-[850px]:hidden" : ""
          }`}
        >
          <AdvancedChart indexToken={pair} />
        </div>
        {/* Order Book — mobile only, kept mounted to preserve WS subscription */}
        <div
          className={`absolute inset-0 hidden ${
            mobileTab === "orderbook" ? "max-[850px]:block" : ""
          }`}
        >
          <OrderBook showHeader={false} />
        </div>
        {/* Trades — mobile only, kept mounted */}
        <div
          className={`absolute inset-0 hidden ${
            mobileTab === "trades" ? "max-[850px]:block" : ""
          }`}
        >
          <RecentTrades />
        </div>
      </div>
    </div>
  )
}
