"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface State {
  error: Error | null
}

/**
 * Top-level boundary so an uncaught render error never blanks the entire
 * page. Without this, anything that throws during render — a stale query
 * cache, a third-party widget (e.g. Vercel preview toolbar), a missing
 * field after auth wipe — propagates to the root and we get a black screen
 * with no recovery affordance.
 *
 * Mount at the very top of the tree so even providers can throw safely.
 */
export class RootErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to ops / Sentry once wired. For now console is the only sink.
    console.error("[RootErrorBoundary]", error, info)
  }

  private handleReload = () => {
    // Full reload — discards any corrupted in-memory state (query cache,
    // zustand stores, WebSocket handles) before re-mounting.
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold">
            Something broke on this page
          </h1>
          <p className="text-sm text-muted-foreground">
            Your wallet and positions are safe. Reloading should recover.
          </p>
          <Button onClick={this.handleReload} className="mt-2">
            Reload
          </Button>
          {process.env.NODE_ENV !== "production" && (
            <pre className="mt-3 max-h-40 w-full overflow-auto rounded bg-muted p-2 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
