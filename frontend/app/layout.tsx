import type { Metadata, Viewport } from "next"
import { ALLOW_INDEXING } from "@/lib/constants/network"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import Web3Provider from "@/lib/providers/Web3Provider"
import { AuthProvider } from "@/lib/providers/AuthProvider"
import { WebSocketProvider } from "@/lib/providers/WebSocketProvider"
import { Header } from "@/components/header"
import { RootErrorBoundary } from "@/components/RootErrorBoundary"
import { SystemHealthGuard } from "@/components/SystemHealthGuard"
import { Toaster } from "sonner"
import { ErudaLoader } from "@/components/dev/eruda-loader"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

// Absolute base for OG/twitter URLs. Prod domain by default; other envs can
// override with `NEXT_PUBLIC_SITE_URL` (their OG links matter less anyway —
// they're noindexed below).
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://app.elysia.finance"

const SITE_NAME = "Elysia Perp"
const SITE_DESCRIPTION =
  "ZK-based Perpetual DEX — trade crypto and RWA perpetuals with EL collateral."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    // Per-page titles ("Trade", "BTC-EL", "Pools", …) render as
    // "<page> | Elysia Perp".
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    // Image comes from app/opengraph-image.tsx (generated at build time);
    // the twitter card falls back to the same image automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: "/icons/logo/el_favi.svg",
  },
  // Only a deployment that explicitly opts in (`NEXT_PUBLIC_ALLOW_INDEXING=true`,
  // set only on prod) is indexable; every other / misconfigured environment
  // stays noindexed by default (fail-safe for SEO).
  ...(!ALLOW_INDEXING && {
    robots: { index: false, follow: false },
  }),
}

export const viewport: Viewport = {
  themeColor: "#09090b",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/*
          Chunk-recovery guard — auto-reload when the browser is holding
          stale HTML whose embedded `_next/static/chunks/*.js` URLs have
          been rotated out by a newer Vercel deployment.

          The failure mode this fixes: a tab left open across one or more
          deploys still references the old build's chunk hashes. When the
          user wakes the laptop / clicks a link / triggers any dynamic
          import, the network returns 403 (or sometimes 404) for those
          chunks, React never hydrates, and the page is just black.

          Strategy: listen for resource-load errors and unhandled promise
          rejections, fingerprint the chunk-load patterns (Next's own
          `ChunkLoadError`, raw `Loading chunk N failed`, script tags
          pointing at `_next/static/`, etc.), and call `location.reload()`
          once per 5-minute window. The sessionStorage cooldown is the
          safety belt — without it a server that *actually* can't serve
          chunks would loop the user.

          This script is inlined intentionally so it runs *before* any
          framework JavaScript: if the framework itself fails to load, an
          external recovery script would fail too.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var KEY = 'ee.chunkReloadAt';
  var COOLDOWN = 5 * 60 * 1000;
  function reloadOnce() {
    try {
      var last = parseInt(sessionStorage.getItem(KEY) || '0', 10);
      if (Date.now() - last < COOLDOWN) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (_) {}
    location.reload();
  }
  function looksLikeChunkFailure(evt) {
    var err = evt && (evt.error || evt.reason);
    var msg = (err && (err.message || String(err))) || '';
    if (/ChunkLoadError|Loading chunk \\d+ failed|Loading CSS chunk \\d+ failed|Failed to fetch dynamically imported module|Importing a module script failed/.test(msg)) {
      return true;
    }
    var target = evt && evt.target;
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      var src = target.src || target.href || '';
      if (/\\/_next\\/static\\/(chunks|css)\\//.test(src)) return true;
    }
    return false;
  }
  window.addEventListener(
    'error',
    function (e) { if (looksLikeChunkFailure(e)) reloadOnce(); },
    true
  );
  window.addEventListener('unhandledrejection', function (e) {
    if (looksLikeChunkFailure(e)) reloadOnce();
  });
})();
`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <RootErrorBoundary>
          <Web3Provider>
            <AuthProvider>
              <WebSocketProvider>
                <div className="flex h-screen flex-col bg-background">
                  <Header />
                  <SystemHealthGuard>{children}</SystemHealthGuard>
                </div>
              </WebSocketProvider>
            </AuthProvider>
          </Web3Provider>
        </RootErrorBoundary>
        <Toaster
          theme="dark"
          position="bottom-right"
          offset="16px"
          // `right`/`bottom` pull the stack slightly off the viewport
          // corner (design feedback); unset sides keep the 16px offset.
          style={
            {
              "--width": "264px",
              right: "32px",
              bottom: "26px",
            } as React.CSSProperties
          }
        />
        <ErudaLoader />
      </body>
    </html>
  )
}
