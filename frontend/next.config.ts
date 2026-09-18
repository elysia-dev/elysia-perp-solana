import type { NextConfig } from "next"

// Baseline security headers applied to every response.
//
// Deliberately NOT setting a Content-Security-Policy here: this is a web3 app
// with an inline chunk-recovery script (see app/layout.tsx), WalletConnect /
// Reown AppKit connectors, and cross-origin WebSocket + RPC traffic. A CSP
// tight enough to matter would need per-request nonces and a full pass against
// every wallet flow — high risk of silently breaking signing. Tracked as a
// follow-up; the headers below harden without that risk.
const SECURITY_HEADERS = [
  // Clickjacking: never allow this signing UI to be framed by another origin.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't let browsers MIME-sniff responses into a different content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send only the origin (no path/query) on cross-origin navigations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Force HTTPS for 2 years incl. subdomains. Vercel already sets this; being
  // explicit keeps it correct on any other host too.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Drop access to device APIs the app never uses.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/candle-api/:path*",
        destination: `${process.env.NEXT_PUBLIC_CANDLE_API_URL || "https://ohlcv-server-dev.up.railway.app"}/:path*`,
      },
      // Faucet lives on a SEPARATE, engine-independent API server (not the perp
      // engine at NEXT_PUBLIC_API_URL). Proxied same-origin so the session
      // cookie is forwarded on the authenticated /faucet + /faucet/claim calls.
      {
        source: "/api-server/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_SERVER_URL || "https://api-server-testnet.up.railway.app"}/api/v1/:path*`,
      },
      // Campaign endpoints can run on a separate backend deployment,
      // selected per-env via NEXT_PUBLIC_CAMPAIGN_API_URL (dev points it at
      // elysia-perp-api-dev). Unset → falls back to the main API, identical
      // to having no rule, so this config is safe on every branch. Must
      // precede the generic /api rule — rewrites are first-match-wins.
      {
        source: "/api/campaigns",
        destination: `${process.env.NEXT_PUBLIC_CAMPAIGN_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/v1/campaigns`,
      },
      {
        source: "/api/campaigns/:path*",
        destination: `${process.env.NEXT_PUBLIC_CAMPAIGN_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/v1/campaigns/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api/v1/:path*`,
      },
    ]
  },
}

export default nextConfig
