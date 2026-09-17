"use client"

/**
 * The "↓ / You receive" summary shared by the deposit and withdraw modals:
 * conversion arrow, converted amount + symbol, USD equivalent, and an
 * optional rate row (callers pass `rateText: null` for 1:1 collaterals like
 * USDT/USDC — "1 USDC = 1 USDC" is just noise).
 */
export function ReceivePanel({
  amountDisplay,
  symbol,
  usdDisplay,
  rateText,
}: {
  amountDisplay: string
  symbol: string
  usdDisplay: string
  rateText?: string | null
}) {
  return (
    <>
      {/* Conversion arrow */}
      <div className="mb-2 mt-2.5 flex justify-center text-base font-medium text-[#0086fc]">
        ↓
      </div>

      {/* You receive */}
      <div className="rounded-md border border-[#0086fc]/35 bg-[#0086fc]/[0.08] p-3">
        <p className="text-[11px] text-muted-foreground">You receive</p>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl text-[#0086fc]">
            {amountDisplay} {symbol}
          </span>
          <span className="text-xs text-muted-foreground">= {usdDisplay}</span>
        </div>
        {rateText ? (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Rate</span>
            <span className="font-mono text-[10px]">{rateText}</span>
          </div>
        ) : null}
      </div>
    </>
  )
}
