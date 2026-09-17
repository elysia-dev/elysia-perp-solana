// TODO: Replace mock with API once Pools backend is ready

import type { Metadata } from "next"
import { EcosystemLogo } from "@/components/trading/ecosystem-logo"
import { PageShell } from "@/components/layout/PageShell"
import { ECOSYSTEMS, getEcosystemById } from "@/lib/config/markets"

export const metadata: Metadata = {
  title: "Pools",
}

interface Pool {
  name: string
  asset: string
  tvl: string
  apy: string
  volume24h: string
  operator: string
  ecosystemId?: string
}

// Foundation-operated vault per ecosystem — collateral token aligns with the
// chain's native asset.
const ECOSYSTEM_VAULTS: Pool[] = [
  {
    ecosystemId: "arbitrum",
    name: "Arbitrum Vault",
    asset: "ARB",
    tvl: "$28.4M",
    apy: "16.84",
    volume24h: "$3.8M",
    operator: "Foundation",
  },
  {
    ecosystemId: "elysia",
    name: "Elysia Vault",
    asset: "EL",
    tvl: "$24.8M",
    apy: "18.42",
    volume24h: "$3.2M",
    operator: "Foundation",
  },
  {
    ecosystemId: "ethereum",
    name: "Ethereum Vault",
    asset: "ETH",
    tvl: "$42.6M",
    apy: "14.92",
    volume24h: "$5.4M",
    operator: "Foundation",
  },
  {
    ecosystemId: "bnb",
    name: "BNB Chain Vault",
    asset: "BNB",
    tvl: "$18.2M",
    apy: "12.45",
    volume24h: "$2.4M",
    operator: "Foundation",
  },
  {
    ecosystemId: "solana",
    name: "Solana Vault",
    asset: "SOL",
    tvl: "$22.4M",
    apy: "15.68",
    volume24h: "$3.1M",
    operator: "Foundation",
  },
  {
    ecosystemId: "optimism",
    name: "Optimism Vault",
    asset: "OP",
    tvl: "$14.6M",
    apy: "13.82",
    volume24h: "$1.8M",
    operator: "Foundation",
  },
  {
    ecosystemId: "hyperliquid",
    name: "Hyperliquid Vault",
    asset: "HYPE",
    tvl: "$11.2M",
    apy: "21.34",
    volume24h: "$1.4M",
    operator: "Foundation",
  },
  {
    ecosystemId: "monad",
    name: "Monad Vault",
    asset: "MON",
    tvl: "$7.8M",
    apy: "19.96",
    volume24h: "$0.9M",
    operator: "Foundation",
  },
]

const FOUNDATION_POOLS: Pool[] = [...ECOSYSTEM_VAULTS]

const USER_POOLS: Pool[] = [
  {
    name: "Alpha Quant",
    asset: "EL",
    tvl: "$2.84M",
    apy: "24.18",
    volume24h: "$642K",
    operator: "0x4f...8a32",
  },
  {
    name: "Delta Neutral One",
    asset: "EL",
    tvl: "$1.62M",
    apy: "11.34",
    volume24h: "$214K",
    operator: "0x9c...12f0",
  },
  {
    name: "KIMP Arb Pool",
    asset: "EL",
    tvl: "$842K",
    apy: "32.85",
    volume24h: "$486K",
    operator: "0x2a...7b1c",
  },
  {
    name: "DeFi Index Maker",
    asset: "EL",
    tvl: "$1.18M",
    apy: "16.42",
    volume24h: "$298K",
    operator: "0x71...3d4e",
  },
  {
    name: "Volatility Edge",
    asset: "EL",
    tvl: "$524K",
    apy: "21.92",
    volume24h: "$182K",
    operator: "0xae...0f99",
  },
]

function PoolTable({ pools }: { pools: Pool[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Table header — desktop only */}
      <div className="hidden grid-cols-[minmax(0,1.4fr)_100px_100px_120px_140px_120px] gap-2 border-b border-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-[851px]:grid">
        <span>Pool</span>
        <span className="text-right">Asset</span>
        <span className="text-right">APY</span>
        <span className="text-right">TVL</span>
        <span className="text-right">24h Volume</span>
        <span className="text-right">Action</span>
      </div>
      {pools.map((p) => {
        const eco = p.ecosystemId ? getEcosystemById(p.ecosystemId) : null
        return (
          <div
            key={p.name}
            className="border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/30 min-[851px]:grid min-[851px]:grid-cols-[minmax(0,1.4fr)_100px_100px_120px_140px_120px] min-[851px]:items-center min-[851px]:gap-2 min-[851px]:text-sm max-[850px]:flex max-[850px]:flex-col max-[850px]:gap-3"
          >
            {/* Pool name + operator (always row 1 on narrow, col 1 on desktop) */}
            <div className="flex min-w-0 items-center gap-2.5">
              {eco && <EcosystemLogo ecosystem={eco} size={22} />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  Operator · {p.operator}
                </div>
              </div>
              {/* Asset chip — narrow only, inline with name */}
              <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground max-[850px]:inline">
                {p.asset}
              </span>
            </div>

            {/* Desktop cells */}
            <span className="hidden text-right text-xs text-muted-foreground min-[851px]:inline">
              {p.asset}
            </span>
            <span className="hidden text-right tabular-nums text-success min-[851px]:inline">
              {p.apy}%
            </span>
            <span className="hidden text-right tabular-nums min-[851px]:inline">
              {p.tvl}
            </span>
            <span className="hidden text-right tabular-nums text-muted-foreground min-[851px]:inline">
              {p.volume24h}
            </span>
            <div className="hidden justify-end min-[851px]:flex">
              <button
                disabled
                className="rounded-md border border-border bg-transparent px-3 py-1 text-xs text-muted-foreground opacity-60"
                title="Coming soon"
              >
                Deposit
              </button>
            </div>

            {/* Narrow-only metric grid + action row */}
            <div className="grid grid-cols-3 gap-2 text-xs min-[851px]:hidden">
              <PoolMetric
                label="APY"
                value={`${p.apy}%`}
                valueClass="text-success"
              />
              <PoolMetric label="TVL" value={p.tvl} />
              <PoolMetric label="24h Volume" value={p.volume24h} />
            </div>
            <button
              disabled
              className="w-full rounded-md border border-border bg-transparent py-2 text-xs text-muted-foreground opacity-60 min-[851px]:hidden"
              title="Coming soon"
            >
              Deposit
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-1 min-[851px]:flex-row min-[851px]:items-baseline min-[851px]:justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="text-xs text-muted-foreground">{description}</span>
    </div>
  )
}

function PoolMetric({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`tabular-nums font-medium ${valueClass ?? "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  )
}

export default function PoolsPage() {
  return (
    <PageShell
      title="Public Pools"
      description="Provide liquidity to Foundation-operated and user-operated vaults. Earn yield from trading fees and funding."
    >
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Foundation Public Pools"
          description={`Ecosystem vaults across ${ECOSYSTEMS.length} chains, operated by Elysia Foundation`}
        />
        <PoolTable pools={FOUNDATION_POOLS} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Users Public Pools"
          description="Permissionless vaults operated by community quants"
        />
        <PoolTable pools={USER_POOLS} />
      </section>
    </PageShell>
  )
}
