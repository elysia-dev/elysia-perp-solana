"use client"

import { useState } from "react"
import { OrderBook } from "@/components/order-book"
import { RecentTrades } from "@/components/recent-trades"

type Tab = "orderbook" | "trades"

export function OrderBookTrades() {
  const [tab, setTab] = useState<Tab>("orderbook")

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card overflow-hidden">
      {/* Tab bar — segmented pill toggle (Figma 2299-5849): the active tab is a
          dark bordered pill, the inactive one is plain gray text. */}
      <div className="flex shrink-0 items-center gap-1 bg-card p-0.5">
        {(
          [
            ["orderbook", "Order Book"],
            ["trades", "Trades"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`h-7 flex-1 cursor-pointer rounded-md border text-xs font-normal transition-colors ${
              tab === value
                ? "border-[#333] bg-[#222] text-[#eee]"
                : "border-transparent bg-transparent text-[#808080] hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "orderbook" ? (
          <OrderBook showHeader={false} />
        ) : (
          <RecentTrades />
        )}
      </div>
    </div>
  )
}
