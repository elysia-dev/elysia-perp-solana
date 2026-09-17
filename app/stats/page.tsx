"use client"

// TODO: Replace mock with API once Stats backend is ready

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { PageShell } from "@/components/layout/PageShell"

interface StatCard {
  label: string
  value: string
  delta: string
  positive: boolean
}

interface MarketRow {
  symbol: string
  price: string
  change24h: string
  volume24h: string
  openInterest: string
}

interface TradeRow {
  time: string
  market: string
  side: "Long" | "Short"
  size: string
  price: string
  trader: string
}

interface TraderRow {
  rank: number
  address: string
  pnl: string
  volume: string
  trades: number
}

const STATS: StatCard[] = [
  { label: "24h Volume", value: "$284.6M", delta: "+12.4%", positive: true },
  { label: "Open Interest", value: "$182.4M", delta: "+4.8%", positive: true },
  {
    label: "Total Trades (24h)",
    value: "48,284",
    delta: "+8.2%",
    positive: true,
  },
  {
    label: "Active Users (24h)",
    value: "2,184",
    delta: "-1.4%",
    positive: false,
  },
]

const VOLUME_SERIES = [
  { day: "Apr 30", volume: 184 },
  { day: "May 1", volume: 218 },
  { day: "May 2", volume: 196 },
  { day: "May 3", volume: 242 },
  { day: "May 4", volume: 268 },
  { day: "May 5", volume: 254 },
  { day: "May 6", volume: 284 },
]

const USERS_SERIES = [
  { day: "Apr 30", users: 1820 },
  { day: "May 1", users: 1942 },
  { day: "May 2", users: 1884 },
  { day: "May 3", users: 2108 },
  { day: "May 4", users: 2218 },
  { day: "May 5", users: 2218 },
  { day: "May 6", users: 2184 },
]

const TOP_MARKETS: MarketRow[] = [
  {
    symbol: "BTC-PERP",
    price: "63,420.50",
    change24h: "+2.34",
    volume24h: "$1.24B",
    openInterest: "$182M",
  },
  {
    symbol: "ETH-PERP",
    price: "3,245.80",
    change24h: "+1.87",
    volume24h: "$842M",
    openInterest: "$96M",
  },
  {
    symbol: "SOL-PERP",
    price: "152.40",
    change24h: "+4.12",
    volume24h: "$418M",
    openInterest: "$48M",
  },
  {
    symbol: "KIMP",
    price: "2.84",
    change24h: "+0.42",
    volume24h: "$18M",
    openInterest: "$2.4M",
  },
  {
    symbol: "ETHBTC",
    price: "0.0512",
    change24h: "-0.62",
    volume24h: "$32M",
    openInterest: "$4.8M",
  },
]

const RECENT_TRADES: TradeRow[] = [
  {
    time: "12:42:18",
    market: "BTC-PERP",
    side: "Long",
    size: "0.420 BTC",
    price: "63,420.50",
    trader: "0x4f...8a32",
  },
  {
    time: "12:42:15",
    market: "ETH-PERP",
    side: "Short",
    size: "12.85 ETH",
    price: "3,245.80",
    trader: "0x9c...12f0",
  },
  {
    time: "12:42:12",
    market: "BTC-PERP",
    side: "Long",
    size: "0.180 BTC",
    price: "63,418.20",
    trader: "0x2a...7b1c",
  },
  {
    time: "12:42:08",
    market: "ETH-PERP",
    side: "Long",
    size: "5.42 ETH",
    price: "3,246.10",
    trader: "0x71...3d4e",
  },
  {
    time: "12:42:04",
    market: "BTC-PERP",
    side: "Short",
    size: "0.082 BTC",
    price: "63,421.80",
    trader: "0xae...0f99",
  },
  {
    time: "12:41:58",
    market: "ETH-PERP",
    side: "Short",
    size: "8.24 ETH",
    price: "3,245.60",
    trader: "0x4f...8a32",
  },
  {
    time: "12:41:54",
    market: "BTC-PERP",
    side: "Long",
    size: "1.240 BTC",
    price: "63,419.40",
    trader: "0xb2...c845",
  },
  {
    time: "12:41:50",
    market: "ETH-PERP",
    side: "Long",
    size: "3.18 ETH",
    price: "3,246.50",
    trader: "0x6d...aa11",
  },
]

const TOP_TRADERS: TraderRow[] = [
  {
    rank: 1,
    address: "0x4f...8a32",
    pnl: "+$842K",
    volume: "$24.8M",
    trades: 1842,
  },
  {
    rank: 2,
    address: "0x9c...12f0",
    pnl: "+$612K",
    volume: "$18.4M",
    trades: 1248,
  },
  {
    rank: 3,
    address: "0x2a...7b1c",
    pnl: "+$418K",
    volume: "$12.6M",
    trades: 824,
  },
  {
    rank: 4,
    address: "0x71...3d4e",
    pnl: "+$284K",
    volume: "$8.4M",
    trades: 612,
  },
  {
    rank: 5,
    address: "0xae...0f99",
    pnl: "+$182K",
    volume: "$5.2M",
    trades: 448,
  },
]

function ChartCard({
  title,
  unit,
  series,
  dataKey,
}: {
  title: string
  unit: string
  series: Array<Record<string, string | number>>
  dataKey: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 max-[850px]:p-3">
      <div className="flex flex-col gap-0.5 min-[851px]:flex-row min-[851px]:items-baseline min-[851px]:justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <div className="h-64 max-[850px]:h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <defs>
              <linearGradient
                id={`grad-${dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="oklch(0.77 0.15 270)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor="oklch(0.77 0.15 270)"
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="oklch(0.269 0 0)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              tick={{ fill: "oklch(0.6 0 0)", fontSize: 11 }}
              stroke="oklch(0.269 0 0)"
            />
            <YAxis
              tick={{ fill: "oklch(0.6 0 0)", fontSize: 11 }}
              stroke="oklch(0.269 0 0)"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "oklch(0.18 0 0)",
                border: "1px solid oklch(0.269 0 0)",
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: "oklch(0.985 0 0)" }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke="oklch(0.77 0.15 270)"
              strokeWidth={2}
              fill={`url(#grad-${dataKey})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function StatsPage() {
  return (
    <PageShell
      title="Stats"
      description="Aggregate trading metrics and live market activity on Elysia Perp."
    >
      {/* Top-line stat cards */}
      <section className="grid grid-cols-4 gap-3 max-[850px]:grid-cols-2 max-[850px]:gap-2">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 max-[850px]:p-3"
          >
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-2xl font-semibold tabular-nums max-[850px]:text-lg">
              {s.value}
            </span>
            <span
              className={`text-xs tabular-nums ${
                s.positive ? "text-success" : "text-destructive"
              }`}
            >
              {s.delta} vs prev 24h
            </span>
          </div>
        ))}
      </section>

      {/* Time-series charts */}
      <section className="grid grid-cols-2 gap-4 max-[850px]:grid-cols-1">
        <ChartCard
          title="Daily Volume"
          unit="USD (millions)"
          series={VOLUME_SERIES}
          dataKey="volume"
        />
        <ChartCard
          title="Daily Active Users"
          unit="unique addresses"
          series={USERS_SERIES}
          dataKey="users"
        />
      </section>

      {/* Top Markets — pulled in from Explorer */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Top Markets</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_100px_140px_140px] gap-2 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground max-[850px]:grid-cols-[minmax(0,1fr)_90px_70px] max-[850px]:px-3">
            <span>Symbol</span>
            <span className="text-right">Price</span>
            <span className="text-right">24h</span>
            <span className="text-right max-[850px]:hidden">Volume</span>
            <span className="text-right max-[850px]:hidden">Open Interest</span>
          </div>
          {TOP_MARKETS.map((m) => {
            const isPositive = !m.change24h.startsWith("-")
            return (
              <div
                key={m.symbol}
                className="grid grid-cols-[minmax(0,1fr)_120px_100px_140px_140px] gap-2 border-b border-border/60 px-4 py-3 text-sm last:border-b-0 max-[850px]:grid-cols-[minmax(0,1fr)_90px_70px] max-[850px]:px-3"
              >
                <span className="font-medium">{m.symbol}</span>
                <span className="text-right tabular-nums">{m.price}</span>
                <span
                  className={`text-right tabular-nums ${
                    isPositive ? "text-success" : "text-destructive"
                  }`}
                >
                  {m.change24h}%
                </span>
                <span className="text-right tabular-nums text-muted-foreground max-[850px]:hidden">
                  {m.volume24h}
                </span>
                <span className="text-right tabular-nums text-muted-foreground max-[850px]:hidden">
                  {m.openInterest}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Recent Trades + Top Traders */}
      <section className="grid grid-cols-[1.6fr_1fr] gap-6 max-[850px]:grid-cols-1 max-[850px]:gap-4">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Recent Trades</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-[100px_minmax(0,1fr)_70px_120px_120px_120px] gap-2 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground max-[850px]:grid-cols-[minmax(0,1fr)_60px_100px] max-[850px]:px-3">
              <span className="max-[850px]:hidden">Time</span>
              <span>Market</span>
              <span>Side</span>
              <span className="text-right max-[850px]:hidden">Size</span>
              <span className="text-right">Price</span>
              <span className="text-right max-[850px]:hidden">Trader</span>
            </div>
            {RECENT_TRADES.map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[100px_minmax(0,1fr)_70px_120px_120px_120px] gap-2 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0 max-[850px]:grid-cols-[minmax(0,1fr)_60px_100px] max-[850px]:px-3"
              >
                <span className="tabular-nums text-muted-foreground max-[850px]:hidden">
                  {t.time}
                </span>
                <span className="flex flex-col font-medium">
                  <span>{t.market}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground min-[851px]:hidden">
                    {t.time} · {t.size}
                  </span>
                </span>
                <span
                  className={
                    t.side === "Long" ? "text-success" : "text-destructive"
                  }
                >
                  {t.side}
                </span>
                <span className="text-right tabular-nums max-[850px]:hidden">
                  {t.size}
                </span>
                <span className="text-right tabular-nums">{t.price}</span>
                <span className="text-right tabular-nums text-muted-foreground max-[850px]:hidden">
                  {t.trader}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Top Traders (24h)</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-[40px_minmax(0,1fr)_100px_100px_60px] gap-2 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground max-[850px]:grid-cols-[32px_minmax(0,1fr)_90px] max-[850px]:px-3">
              <span>#</span>
              <span>Address</span>
              <span className="text-right">PnL</span>
              <span className="text-right max-[850px]:hidden">Volume</span>
              <span className="text-right max-[850px]:hidden">Trades</span>
            </div>
            {TOP_TRADERS.map((t) => (
              <div
                key={t.rank}
                className="grid grid-cols-[40px_minmax(0,1fr)_100px_100px_60px] gap-2 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0 max-[850px]:grid-cols-[32px_minmax(0,1fr)_90px] max-[850px]:px-3"
              >
                <span className="font-semibold text-muted-foreground">
                  {t.rank}
                </span>
                <span className="flex flex-col font-medium">
                  <span>{t.address}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground min-[851px]:hidden">
                    {t.volume} · {t.trades} trades
                  </span>
                </span>
                <span className="text-right tabular-nums text-success">
                  {t.pnl}
                </span>
                <span className="text-right tabular-nums max-[850px]:hidden">
                  {t.volume}
                </span>
                <span className="text-right tabular-nums text-muted-foreground max-[850px]:hidden">
                  {t.trades}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  )
}
