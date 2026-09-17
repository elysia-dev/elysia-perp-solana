import { cn } from "@/lib/utils"
import { SkeletonRows } from "@/components/order-book"

/** A single shimmering placeholder bar. Same muted tone the orderbook
 *  skeleton rows use, so the whole terminal skeleton reads as one piece. */
function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-muted/50", className)} />
}

/**
 * Initial-load skeleton for the Trade terminal.
 *
 * Mirrors the real `TradeMarketPage` layout (chart + orderbook column,
 * history panel, trading-form column — same widths/breakpoints) so the
 * transition into live content fades in place instead of swapping a
 * full-screen spinner for the whole UI. Replaces the previous centered
 * `Loading markets…` spinner, which read as a jarring blank→full screen flip.
 */
export function TradeSkeleton() {
  return (
    <main
      className="flex min-h-0 flex-1 gap-3 p-3 pb-20 min-[851px]:pb-3"
      aria-busy="true"
      aria-label="Loading market"
    >
      {/* Left: chart + orderbook, then history */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 min-w-0 flex-2 flex-col gap-3 min-[851px]:flex-row">
          {/* Chart */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <Bar className="h-5 w-32" />
              <Bar className="h-5 w-20" />
              <Bar className="h-5 w-20" />
              <Bar className="h-5 w-16" />
            </div>
            <Bar className="min-h-0 flex-1 opacity-40" />
          </div>

          {/* Orderbook column — reuses the orderbook's own SkeletonRows so the
              network-load skeleton matches the orderbook loading skeleton. */}
          <div className="hidden w-56 shrink-0 flex-col gap-1 rounded-lg border border-border bg-card p-3 min-[851px]:flex md:w-64 lg:w-72 xl:w-80">
            <Bar className="mb-1 h-4 w-24" />
            <SkeletonRows count={8} />
            {/* Last-price placeholder (matches the orderbook center skeleton) */}
            <div className="my-0.5 flex flex-col items-center gap-1.5 rounded bg-muted/20 px-2 py-2.5">
              <div className="h-3.5 w-20 animate-pulse rounded bg-muted/50" />
              <div className="h-2 w-14 animate-pulse rounded bg-muted/30" />
            </div>
            <SkeletonRows count={8} />
          </div>
        </div>

        {/* History panel */}
        <div className="flex max-h-[480px] min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Bar key={`tab-${i}`} className="h-4 w-20" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Bar key={`row-${i}`} className="h-3 w-full opacity-50" />
          ))}
        </div>
      </div>

      {/* Right: trading form */}
      <div className="hidden w-56 shrink-0 flex-col gap-3 rounded-lg border border-border bg-card p-3 min-[851px]:flex md:w-64 lg:w-72 xl:w-[320px]">
        <div className="flex gap-2">
          <Bar className="h-9 flex-1" />
          <Bar className="h-9 flex-1" />
        </div>
        <Bar className="h-4 w-20" />
        <Bar className="h-10 w-full" />
        <Bar className="h-10 w-full" />
        <Bar className="h-2 w-full" />
        <Bar className="h-11 w-full" />
        <div className="mt-2 flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bar key={`info-${i}`} className="h-3 w-full opacity-50" />
          ))}
        </div>
      </div>
    </main>
  )
}
