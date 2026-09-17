import { NextResponse } from "next/server"

// Server-side proxy for the EL token price from CoinGecko `simple/price`.
//
// Why a proxy (not a direct browser call):
//   • rate limits — every client hitting CoinGecko directly would exhaust the
//     free-tier quota; here one cached fetch serves all clients,
//   • the API key stays server-only (never shipped to the bundle).
//
// Env:
//   COINGECKO_API_KEY   — demo/free API key (sent as `x-cg-demo-api-key`).
//                         Optional; CoinGecko allows keyless calls at a lower
//                         rate limit, so a missing key still works for dev.
//   COINGECKO_EL_ID     — CoinGecko coin id for EL (default "elysia").

const EL_ID = process.env.COINGECKO_EL_ID || "elysia"
const CACHE_TTL_MS = 60_000

interface ElPrice {
  usd: number
  usd_24h_change: number
}

// Module-level cache: at most one upstream call per CACHE_TTL_MS, shared across
// all clients hitting this route.
let cache: { at: number; data: ElPrice } | null = null

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  try {
    const key = process.env.COINGECKO_API_KEY
    const url =
      `https://api.coingecko.com/api/v3/simple/price` +
      `?ids=${encodeURIComponent(EL_ID)}&vs_currencies=usd&include_24hr_change=true`

    const res = await fetch(url, {
      headers: key ? { "x-cg-demo-api-key": key } : {},
      cache: "no-store", // we manage our own TTL above
    })

    if (!res.ok) {
      // Serve stale-but-valid data through a transient upstream hiccup.
      if (cache) return NextResponse.json(cache.data)
      return NextResponse.json(
        { error: "el price unavailable" },
        { status: 502 }
      )
    }

    const json = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number } | undefined
    >
    const entry = json[EL_ID]
    const data: ElPrice = {
      usd: entry?.usd ?? 0,
      usd_24h_change: entry?.usd_24h_change ?? 0,
    }
    cache = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch {
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json({ error: "el price unavailable" }, { status: 502 })
  }
}
