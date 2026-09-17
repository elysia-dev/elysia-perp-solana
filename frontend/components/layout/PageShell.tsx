import type { ReactNode } from "react"

interface PageShellProps {
  /** Omit to render children only — the page places its own heading. */
  title?: string
  description?: ReactNode
  children: ReactNode
}

export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 max-[850px]:gap-4 max-[850px]:p-3">
      {title && (
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold max-[850px]:text-xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </header>
      )}
      {children}
    </main>
  )
}
