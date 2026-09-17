"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useMarketStore, useSelectedPair } from "@/lib/stores"
import { useMarkPriceStore } from "@/lib/stores/useMarkPriceStore"
import { useMediaQuery } from "@/lib/hooks/useMediaQuery"
import { formatPrice } from "@/lib/utils/format"
import {
  CATEGORIES,
  EXTENDED_MARKETS,
  ICONED_BASES,
  isPairRoutable,
  type ExtendedMarketCategory,
} from "@/lib/config/markets"
import { tradingToast } from "@/lib/utils/toast"

interface MarketSelectorDialogProps {
  trigger: React.ReactNode
}

const hasTokenIcon = (symbol: string) =>
  ICONED_BASES.has(symbol.split("-")[0].toLowerCase())
const LISTABLE_MARKETS = EXTENDED_MARKETS.filter((m) => hasTokenIcon(m.symbol))
// Only show tabs for categories that still have at least one listable market.
const VISIBLE_CATEGORIES = CATEGORIES.filter((c) =>
  LISTABLE_MARKETS.some((m) => m.category === c.id)
)

// "All" leads the tab strip (and is the default): live markets are spread
// across categories (BTC=major, SPY=equities, USDKRW=fx), so without it
// there's no single view that shows everything tradable at once.
type TabId = "all" | ExtendedMarketCategory
const DEFAULT_TAB: TabId = "all"
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  ...VISIBLE_CATEGORIES,
]

/** Market row icon: token svg with a neutral-dot fallback (only a handful of
 *  token svgs exist; everything else renders as a muted circle). */
function MarketIcon({ base }: { base: string }) {
  const [errored, setErrored] = useState(false)
  if (errored) {
    return (
      <span className="inline-block size-6 shrink-0 rounded-full bg-muted" />
    )
  }
  return (
    <Image
      src={`/icons/tokens/${base.toLowerCase()}.svg`}
      alt={base}
      width={24}
      height={24}
      onError={() => setErrored(true)}
      className="size-6 shrink-0 rounded-full"
    />
  )
}

export function MarketSelectorDialog({ trigger }: MarketSelectorDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<TabId>(DEFAULT_TAB)
  const [search, setSearch] = useState("")

  const selectedPair = useSelectedPair()
  const pairs = useMarketStore((s) => s.pairs)
  const markPrices = useMarkPriceStore((s) => s.markPrices)

  // Markets now list against the CURRENT collateral (the selected pair's quote)
  // — collateral is picked in its own dropdown, so this dialog no longer owns
  // an ecosystem sidebar.
  const currentQuote = selectedPair.quote_currency

  const resolvePair = (symbol: string) => {
    const base = symbol.split("-")[0].toUpperCase()
    // Prefer the variant quoted in the CURRENT market's collateral (keeps
    // "browse markets" collateral-stable), but fall back to ANY live pair
    // with that base: some markets exist in a single collateral only —
    // USDKRW-PERP-USDT (ELP-499) is USDT-quoted, and without the fallback
    // it would read "Soon" forever whenever the user is on an EL market.
    // Picking it then switches the collateral context, which is exactly
    // what the user asked for by selecting that market.
    // isPairRoutable keeps retired quote variants out of BOTH branches —
    // e.g. from USDKRW (USDT collateral), picking BTC must land on
    // BTC-PERP-EL, never the still-listed BTC-PERP-USDT.
    const routable = pairs.filter(
      (p) =>
        p.base.toUpperCase() === base && isPairRoutable(base, p.quote_currency)
    )
    return (
      routable.find((p) => p.quote_currency === currentQuote) ?? routable[0]
    )
  }

  const visibleMarkets = useMemo(() => {
    const term = search.trim().toLowerCase()
    const filtered = LISTABLE_MARKETS.filter((m) => {
      if (!term && category !== "all" && m.category !== category) return false
      if (!term) return true
      return (
        m.symbol.toLowerCase().includes(term) ||
        m.name.toLowerCase().includes(term)
      )
    })
    // Live (tradable) markets sort ahead of "Soon" teasers — the All tab
    // exists precisely to surface everything live at a glance. Stable sort
    // keeps the curated order within each group. MUST mirror the row's own
    // Live/Soon logic (`available` AND a routable pair): dev still lists
    // ETH-PERP-EL on the server, so a pairs-only check would rank ETH as
    // live while its badge reads "Soon".
    const isLiveMarket = (m: (typeof LISTABLE_MARKETS)[number]) => {
      if (!m.available) return false
      const base = m.symbol.split("-")[0].toUpperCase()
      return pairs.some(
        (p) =>
          p.base.toUpperCase() === base &&
          isPairRoutable(base, p.quote_currency)
      )
    }
    return filtered.sort(
      (a, b) => Number(isLiveMarket(b)) - Number(isLiveMarket(a))
    )
  }, [category, search, pairs])

  const handleSelect = (symbol: string) => {
    const market = EXTENDED_MARKETS.find((m) => m.symbol === symbol)
    if (!market) return
    if (market.available) {
      const found = resolvePair(symbol)
      if (found) {
        // `replace` (not `push`) so flipping through markets doesn't grow
        // history — Back should exit the trade view, not rewind symbols.
        router.replace(`/trade/${found.name}`)
        setOpen(false)
        return
      }
    }
    tradingToast.info("Coming soon", `${market.symbol} is not yet live.`)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSearch("")
      setCategory(DEFAULT_TAB)
    }
    setOpen(next)
  }

  const isNarrow = useMediaQuery("(max-width: 850px)")

  const body = (
    <SelectorBody
      category={category}
      setCategory={setCategory}
      search={search}
      setSearch={setSearch}
      visibleMarkets={visibleMarkets}
      resolvePair={resolvePair}
      selectedPairId={selectedPair.id}
      onSelect={handleSelect}
      markPrices={markPrices}
    />
  )

  if (isNarrow) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90vh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-popover shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              Select Market
            </DialogPrimitive.Title>
            <div className="relative flex shrink-0 items-center justify-center px-4 pb-2 pt-3">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              <DialogPrimitive.Close
                aria-label="Close"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
            <div className="min-h-0 flex-1">{body}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }

  return (
    // `modal`: the popover floats over the TradingView chart IFRAME — clicks
    // inside an iframe never reach this document, so the default (non-modal)
    // outside-click detection can't see them and the popover stays open.
    // Modal mode intercepts outside pointerdowns in the parent document
    // before they enter the iframe, so any outside click dismisses.
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[480px] gap-0 overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-xl"
      >
        {body}
      </PopoverContent>
    </Popover>
  )
}

interface SelectorBodyProps {
  category: TabId
  setCategory: (c: TabId) => void
  search: string
  setSearch: (s: string) => void
  visibleMarkets: typeof EXTENDED_MARKETS
  resolvePair: (symbol: string) => import("@/types").Pair | undefined
  selectedPairId: number
  onSelect: (symbol: string) => void
  markPrices: Map<string, import("@/types").MarkPriceResponse>
}

function SelectorBody({
  category,
  setCategory,
  search,
  setSearch,
  visibleMarkets,
  resolvePair,
  selectedPairId,
  onSelect,
  markPrices,
}: SelectorBodyProps) {
  return (
    <div className="flex h-[500px] max-h-full min-w-0 flex-col max-[850px]:h-[75vh]">
      {/* Search */}
      <div className="shrink-0 px-4 pb-2 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets…"
            className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3">
        {TABS.map((cat) => {
          const isActive = cat.id === category
          return (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`relative h-9 shrink-0 cursor-pointer px-3 text-sm font-medium transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.label}
              {isActive && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          )
        })}
      </div>

      {/* Column header */}
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_110px_80px] gap-2 px-4 py-2 text-xs text-muted-foreground">
        <span>Market</span>
        <span className="text-right">Price</span>
        <span className="text-right">24h</span>
      </div>

      {/* Market list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visibleMarkets.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No markets found
          </div>
        ) : (
          visibleMarkets.map((m) => {
            const resolved = resolvePair(m.symbol)
            const isLive = m.available && resolved != null
            const live =
              isLive && resolved ? markPrices.get(resolved.name) : undefined
            const liveChange = live?.daily_change
              ? parseFloat(live.daily_change)
              : null
            // Non-live markets have no real feed — show "-" instead of the mock
            // placeholder numbers (only the live market renders price/24h).
            const displayPrice =
              isLive && live?.mark_price
                ? formatPrice(parseFloat(live.mark_price))
                : "-"
            const displayChange =
              isLive && liveChange != null
                ? `${liveChange >= 0 ? "+" : ""}${liveChange.toFixed(2)}%`
                : "-"
            const changeClass =
              !isLive || liveChange == null
                ? "text-muted-foreground"
                : liveChange >= 0
                  ? "text-success"
                  : "text-destructive"
            const isCurrent = resolved != null && resolved.id === selectedPairId
            const base = m.symbol.split("-")[0]
            return (
              <button
                key={m.symbol}
                onClick={() => onSelect(m.symbol)}
                className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_110px_80px] items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 ${
                  isLive ? "" : "opacity-70"
                } ${isCurrent ? "bg-muted/30" : ""}`}
              >
                <span className="flex items-center gap-3 text-left">
                  <MarketIcon base={base} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{base}</span>
                      {isLive && !m.displaySoon ? (
                        <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                          Live
                        </span>
                      ) : (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Soon
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.name}
                    </span>
                  </span>
                </span>
                <span className="text-right tabular-nums">{displayPrice}</span>
                <span className={`text-right tabular-nums ${changeClass}`}>
                  {displayChange}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
