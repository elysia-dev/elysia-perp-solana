"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { getLastVisitedMarket } from "@/lib/hooks/useUrlMarketSync"

/**
 * Root redirect. The real trading UI lives at `/trade/[market]` — see
 * `app/trade/[market]/page.tsx`. We don't render the trading page at `/`
 * directly because we want the URL to always reflect which market the
 * user is looking at (shareable links, browser back/forward, etc.).
 *
 * We do the redirect on the client instead of as a Next.js server
 * `redirect()` so we can honour the user's last-visited market from
 * `localStorage` — a server redirect can't see browser storage and would
 * always send everyone to the global default.
 *
 * The spinner is only visible for the millisecond between mount and
 * `router.replace`; if the user has JS disabled they get the static
 * loading screen but the app wouldn't work for them anyway.
 */
export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Preserve the query string across the redirect so links that land on the
    // ROOT with params (`/?ref=…`) carry them through to the trade page.
    router.replace(`/trade/${getLastVisitedMarket()}${window.location.search}`)
  }, [router])

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    </main>
  )
}
