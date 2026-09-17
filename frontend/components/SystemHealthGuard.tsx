"use client"

import { useEffect, type ReactNode } from "react"
import { PlugZap } from "lucide-react"
import { useSystemHealthStore } from "@/lib/stores/useSystemHealthStore"

// Cheap public endpoint — used only as a liveness ping when we're already
// in the unhealthy state. Avoids re-mounting the rest of the app just to
// retry, which would cause subscription churn.
const HEALTH_PROBE_URL = "/api/markets"
const HEALTH_PROBE_INTERVAL_MS = 5_000

interface SystemHealthGuardProps {
  children: ReactNode
}

export function SystemHealthGuard({ children }: SystemHealthGuardProps) {
  const isHealthy = useSystemHealthStore((s) => s.isHealthy)

  // While unhealthy, silently ping a public endpoint so the page recovers
  // automatically when the backend comes back — even if the user has been
  // staring at the unavailable card and no other API call is running. Visible
  // UI doesn't change; the children just remount on success.
  useEffect(() => {
    if (isHealthy) return
    let cancelled = false
    const probe = async () => {
      try {
        const res = await fetch(HEALTH_PROBE_URL, { cache: "no-store" })
        if (!cancelled && res.ok) {
          useSystemHealthStore.getState().setHealthy()
        }
      } catch {
        // Network still down — keep polling on the next tick.
      }
    }
    const id = setInterval(probe, HEALTH_PROBE_INTERVAL_MS)
    // Probe once immediately so a quick recovery doesn't have to wait a tick.
    probe()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isHealthy])

  if (isHealthy) return <>{children}</>
  return <ServerUnavailableState />
}

function ServerUnavailableState() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-border bg-card p-8 text-center max-[850px]:p-6">
        <PlugZap className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">
          We&rsquo;re having trouble connecting
        </h1>
        <p className="text-sm text-muted-foreground">
          Our servers are temporarily unavailable.
        </p>
        <p className="text-xs text-muted-foreground">
          Your wallet and positions are safe. Trading will resume when the
          connection is restored.
        </p>
      </div>
    </main>
  )
}
