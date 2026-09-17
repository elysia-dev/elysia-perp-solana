"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { getLastVisitedMarket } from "@/lib/hooks/useUrlMarketSync"

/**
 * `/trade` (with no market segment) bounces to `/trade/<last-visited>`.
 * Same logic as the root redirect — see `app/page.tsx`. Without this,
 * `/trade` would 404 because the only thing under `app/trade/` is the
 * `[market]` dynamic route which expects a segment.
 */
export default function TradeIndex() {
  const router = useRouter()

  useEffect(() => {
    // Preserve the query string (UTM params etc.) — same reasoning as the
    // root redirect in app/page.tsx.
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
