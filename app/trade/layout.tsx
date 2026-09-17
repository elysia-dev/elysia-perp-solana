import type { Metadata } from "next"

// `app/trade/page.tsx` is a client component ("use client") and cannot export
// metadata itself — this pass-through layout carries the segment title.
// The deeper `[market]` segment overrides it with the market name.
export const metadata: Metadata = {
  title: {
    default: "Trade",
    // Must be re-declared here: `title.template` only reaches the segments
    // DIRECTLY below the layout that defines it. This layout setting a title
    // without a template would strip the root template from `[market]` —
    // verified: /trade/BTC-EL rendered a bare "BTC-EL" instead of
    // "BTC-EL | Elysia Perp" until this was added.
    template: "%s | Elysia Perp",
  },
}

export default function TradeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
