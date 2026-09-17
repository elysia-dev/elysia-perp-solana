import type { Metadata } from "next"

// `app/stats/page.tsx` is a client component ("use client") and cannot export
// metadata itself — this pass-through layout carries the segment title.
export const metadata: Metadata = {
  title: "Stats",
}

export default function StatsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
