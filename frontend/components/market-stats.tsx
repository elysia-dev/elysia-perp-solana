"use client"

import { useEffect, useState } from "react"
import { useSelectedPair } from "@/lib/stores"
import {
  useMarkPriceStore,
  selectMarkPriceData,
} from "@/lib/stores/useMarkPriceStore"
import { getEcosystemByQuoteAssetId } from "@/lib/config/markets"
import { EcosystemLogo } from "@/components/trading/ecosystem-logo"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatPrice,
  formatUsdCompact,
  formatBaseVolumeCompact,
  numOrZero,
} from "@/lib/utils/format"

function calcCountdown() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(now.getHours() + 1, 0, 0, 0)
  const totalSeconds = Math.ceil((next.getTime() - now.getTime()) / 1_000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const fmtPct = (v: number) => `${v.toFixed(4)}%`

function useNextFundingCountdown() {
  const [remaining, setRemaining] = useState(calcCountdown)

  useEffect(() => {
    const id = setInterval(() => setRemaining(calcCountdown()), 1_000)
    return () => clearInterval(id)
  }, [])

  return remaining
}

export function MarketStats() {
  const pair = useSelectedPair()
  const priceData = useMarkPriceStore(selectMarkPriceData(pair.name))
  const nextFunding = useNextFundingCountdown()
  // Collateral chip mirrors the *selected market's* quote currency, not
  // the global ecosystem browse filter. Without this, the narrow-screen
  // collateral chip would say "EL" on a BTC-PERP-ARB chart whenever the
  // ecosystem store and the actual market diverged (URL deep link, or
  // sidebar click without committing a market).
  const ecosystem = getEcosystemByQuoteAssetId(pair.quote_currency)

  const markPrice = numOrZero(priceData?.mark_price)
  const indexPrice = numOrZero(priceData?.index_price)
  const dailyVolume = numOrZero(priceData?.daily_volume)
  const dailyBaseVolume = numOrZero(priceData?.daily_base_volume)
  const dailyChange = numOrZero(priceData?.daily_change)
  const dailyHigh = priceData?.daily_high ?? "0"
  const dailyLow = priceData?.daily_low ?? "0"
  const openInterest = numOrZero(priceData?.open_interest)
  // funding_rate is already in % (converted in useMarkPriceSync), and is the
  // 8-hour rate — divide by 8 for the hourly funding shown here.
  const eightHourRate = numOrZero(priceData?.funding_rate)
  const hourlyFunding = eightHourRate / 8
  const annualized = hourlyFunding * 24 * 365
  const hourlyCapPercent = numOrZero(priceData?.funding_cap_1hr)

  return (
    <div className="grid grid-cols-4 gap-x-3 gap-y-2 text-xs min-[851px]:flex min-[851px]:items-center min-[851px]:gap-[35px] min-[851px]:overflow-x-auto">
      <Stat label="Mark Price" value={formatPrice(markPrice)} />
      <Stat label="Index Price" value={formatPrice(indexPrice)} />
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="shrink-0">
              <Stat
                label="24h Change"
                value={`${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}%`}
                valueClass={
                  dailyChange >= 0 ? "text-success" : "text-destructive"
                }
              />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="center"
            className="rounded-lg bg-popover p-0 text-popover-foreground shadow-lg border border-border"
          >
            <div className="space-y-1 p-3 text-xs">
              <div className="flex items-center justify-between gap-6 font-mono">
                <span className="text-muted-foreground">24h High:</span>
                <span className="font-medium text-foreground">
                  {formatPrice(parseFloat(dailyHigh))}
                </span>
              </div>
              <div className="flex items-center justify-between gap-6 font-mono">
                <span className="text-muted-foreground">24h Low:</span>
                <span className="font-medium text-foreground">
                  {formatPrice(parseFloat(dailyLow))}
                </span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="shrink-0">
              <Stat label="24h Volume" value={formatUsdCompact(dailyVolume)} />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="center"
            className="rounded-lg bg-popover px-3 py-2 text-popover-foreground shadow-lg border border-border"
          >
            <span className="text-xs font-mono font-medium">
              {formatBaseVolumeCompact(dailyBaseVolume)} {pair.base}
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Stat label="Open Interest" value={formatUsdCompact(openInterest)} />
      <div className="flex items-center gap-3 rounded border border-border/50 bg-muted/30 px-2 py-0.5 max-[850px]:contents">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help">
                <Stat
                  label="1hr Funding"
                  value={fmtPct(hourlyFunding)}
                  valueClass="text-primary"
                  underline
                />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="center"
              className="w-72 rounded-lg bg-popover p-0 text-popover-foreground shadow-lg border border-border"
            >
              <div className="space-y-1 p-3 text-xs">
                <FundingRow
                  label="1hr Funding:"
                  value={fmtPct(hourlyFunding)}
                />
                <FundingRow label="8hr:" value={fmtPct(eightHourRate)} />
                <FundingRow label="Annualized:" value={fmtPct(annualized)} />
                <FundingRow label="1hr Cap:" value={fmtPct(hourlyCapPercent)} />
              </div>
              {/* TODO: Update description text to match our specific funding mechanism */}
              <div className="border-t border-border px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Funding payments occur hourly based on the contract and index
                price difference. Longs pay shorts if the rate is positive, and
                shorts pay longs if negative. Funding is peer-to-peer, with no
                fees taken by the exchange.
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Stat label="Next Funding" value={nextFunding} suppressHydration />
      </div>
      {/* Ecosystem collateral cell — narrow screens only (desktop has its own indicator in header) */}
      <div className="flex shrink-0 items-center gap-1.5 min-[851px]:hidden">
        <EcosystemLogo ecosystem={ecosystem} size={16} />
        <span className="text-sm font-semibold">
          {ecosystem.collateralToken}
        </span>
      </div>
    </div>
  )
}

function FundingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between font-mono">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  valueClass,
  underline,
  suppressHydration,
}: {
  label: string
  value: string
  valueClass?: string
  underline?: boolean
  // For clock-derived values (funding countdown): the server-rendered text is
  // legitimately a tick older than the client's hydration render, so let React
  // keep the server text instead of flagging a mismatch — the 1s interval
  // corrects it immediately after mount.
  suppressHydration?: boolean
}) {
  return (
    <div className="flex shrink-0 flex-col whitespace-nowrap">
      <span
        className={`text-muted-foreground text-[11px] leading-tight ${underline ? "underline decoration-dotted underline-offset-2" : ""}`}
      >
        {label}
      </span>
      <span
        suppressHydrationWarning={suppressHydration}
        className={`tabular-nums font-medium text-sm leading-tight ${valueClass ?? "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  )
}
