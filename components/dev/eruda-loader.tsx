"use client"

import { useEffect } from "react"

// On-page devtools for environments with no inspector (wallet in-app
// browsers, Samsung Internet). Opt-in only: append `?eruda=1` to the URL.
// Loads from CDN at runtime — nothing ships in the bundle for normal visits.
export function ErudaLoader() {
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("eruda")) return
    if (document.getElementById("eruda-script")) return
    const script = document.createElement("script")
    script.id = "eruda-script"
    script.src = "https://cdn.jsdelivr.net/npm/eruda@3/eruda.min.js"
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).eruda?.init()
    }
    document.body.appendChild(script)
  }, [])
  return null
}
