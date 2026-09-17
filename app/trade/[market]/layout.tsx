import type { Metadata } from "next"

// Market-specific title/OG ("BTC-EL | Elysia Perp") for shared links. The
// page itself is a client component, so the title lives in this server
// layout. `market` comes straight from the URL (e.g. /trade/BTC-EL) — no
// fetch needed; an unknown market still renders a sane title while the page
// handles the actual not-found UX.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ market: string }>
}): Promise<Metadata> {
  const { market } = await params
  const name = decodeURIComponent(market).toUpperCase()
  return {
    title: name,
    // `openGraph` is REPLACED (not deep-merged) with the root layout's —
    // verified: overriding only title/description dropped og:url, og:site_name,
    // og:type AND the root's generated og:image from the rendered page. So
    // every field is spelled out, image included.
    openGraph: {
      type: "website",
      siteName: "Elysia Perp",
      url: `/trade/${market}`,
      title: `${name} | Elysia Perp`,
      description: `Trade ${name} perpetuals on Elysia Perp.`,
      images: "/opengraph-image.png",
    },
  }
}

export default function MarketLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
