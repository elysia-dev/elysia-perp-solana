"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useAppKit, useAppKitAccount, useDisconnect } from "@reown/appkit/react"
// EVM (wagmi) address is read only to gate the dormant EVM-only widgets
// (Mint / Deposit / Withdraw modals); connection identity is Solana.
import { useConnection } from "wagmi"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  LogOut,
} from "lucide-react"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSolBalance } from "@/lib/solana/useSolBalance"
import { SolanaDepositModal } from "@/components/solana-deposit-modal"
import { SolanaWithdrawModal } from "@/components/solana-withdraw-modal"
import { MintModal } from "@/components/mint-modal"
import { AuthModal } from "@/components/auth-modal"
import { DevToolbar } from "@/components/dev/dev-toolbar"
import { usePendingDepositMonitor } from "@/lib/hooks/usePendingDepositMonitor"
import { useBalance } from "@/lib/hooks/useBalance"
import { isLoggedInCookiePresent } from "@/lib/utils/cookie"
import { useSelectedPair } from "@/lib/stores"
import { useDepositWithdrawModal } from "@/lib/stores/useDepositWithdrawModal"
import { SHOW_TEST_UI } from "@/lib/constants/network"
import { formatAddress } from "@/lib/utils"

function MintButton({ address }: { address: `0x${string}` }) {
  const [mintOpen, setMintOpen] = useState(false)
  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="mr-[10px]"
              onClick={() => setMintOpen(true)}
            >
              Mint
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Mint test tokens (EL / USDT)</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <MintModal open={mintOpen} onOpenChange={setMintOpen} address={address} />
    </>
  )
}

/** Book icon for the Guide button (design asset guide_icon.svg, recolored
 *  to currentColor so it follows the button's text color). */
function GuideIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
      <path
        d="M12 20.292C13.6484 18.8134 15.7856 17.997 18 18C19.0218 17.9989 20.0364 18.172 21 18.512V4.26201C20.062 3.93001 19.052 3.75001 18 3.75001C15.7856 3.74686 13.6483 4.56328 12 6.04201C10.3516 4.56337 8.2144 3.74695 6 3.75001C4.948 3.75001 3.938 3.93001 3 4.26201V18.512C3.96362 18.172 4.97816 17.9989 6 18C8.305 18 10.408 18.867 12 20.292ZM12 6.04201V20.292"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const GUIDE_URLS = {
  desktop:
    "https://elysia.gitbook.io/elysia-perps/getting-started/user-guide-desktop",
  mobile:
    "https://elysia.gitbook.io/elysia-perps/getting-started/user-guide-mobile",
} as const

const NAV_ITEMS = [
  // `/trade` (without a market segment) bounces to the user's last-visited
  // market via `app/trade/page.tsx`. Pointing the Trade nav here — rather
  // than at `/` — means clicking it from another section feels like
  // "return to where I was" rather than "reset to the global default".
  { href: "/trade", label: "Trade" },
  // Solana hackathon build: Trade-only. Points / Pre-Staking / Get EL nav
  // removed (their routes still exist but aren't linked).
] as const

function isNavActive(href: string, pathname: string | null) {
  // Trade tab is active for the root redirect (`/`) AND for any
  // `/trade/<market>` page. Without the `/` clause the nav highlight
  // would briefly clear during the root→/trade/[market] redirect.
  if (href === "/trade") {
    return pathname === "/" || !!pathname?.startsWith("/trade")
  }
  return !!pathname?.startsWith(href)
}

export function Header() {
  // Wallet identity comes from the connected Solana wallet (Reown AppKit).
  const { address, isConnected } = useAppKitAccount({ namespace: "solana" })
  const status: "connected" | "disconnected" = isConnected
    ? "connected"
    : "disconnected"
  // EVM address (empty on this branch — EVM adapter disabled) drives the
  // dormant ERC20 balance/mint widgets only, never the connection state.
  const { address: evmAddress } = useConnection()
  const pathname = usePathname()
  const { open } = useAppKit()
  const { disconnect } = useDisconnect()
  const {
    isAuthenticated,
    login,
    isLoggingIn,
    accountSwitched,
    clearAccountSwitched,
    isRefreshing,
    isAuthReady,
    showAuthModal,
    setShowAuthModal,
  } = useAuth()
  // Shared with the trade panel's Deposit/Withdraw buttons via a store so a
  // single modal instance (below) serves both entry points.
  const depositOpen = useDepositWithdrawModal((s) => s.depositOpen)
  const setDepositOpen = useDepositWithdrawModal((s) => s.setDepositOpen)
  const withdrawOpen = useDepositWithdrawModal((s) => s.withdrawOpen)
  const setWithdrawOpen = useDepositWithdrawModal((s) => s.setWithdrawOpen)
  const selectedPair = useSelectedPair()
  usePendingDepositMonitor()
  const { data: balanceData } = useBalance()
  // Wallet Balance = the connected wallet's native SOL on devnet (the cluster
  // the vault program lives on). Replaces the EVM ERC20 read.
  const { data: solBalance } = useSolBalance()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  const formattedWalletBalance = useMemo(() => {
    if (solBalance == null) return "-"
    const truncated = Math.floor(solBalance * 1e6) / 1e6
    return truncated.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }, [solBalance])
  const perpAvailable = balanceData?.balances?.find(
    (b) => b.asset_id === selectedPair.quote_currency
  )?.available
  const perpNum = perpAvailable != null ? parseFloat(perpAvailable) : null
  const formattedPerpBalance =
    perpNum != null
      ? (Math.floor(perpNum * 100) / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "-"
  // Track mounted state for hydration safety
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Track if we've attempted login for current connection
  const hasAttemptedLogin = useRef(false)
  const prevStatus = useRef(status)

  const handleWithdraw = () => {
    setWithdrawOpen(true)
  }

  // Auto-login when wallet connects
  useEffect(() => {
    // Reset flag when disconnected or auth cleared
    if (status === "disconnected" || !isAuthenticated) {
      hasAttemptedLogin.current = false
    }

    // Wait for auth state to be ready (cookie checked after hydration)
    if (!isAuthReady) return

    // Skip if already authenticated (checked via logged_in cookie)
    if (isAuthenticated) {
      hasAttemptedLogin.current = true
      return
    }

    // Skip if refresh is in progress (AuthProvider is attempting to refresh token)
    if (isRefreshing) return

    // Detect transition to 'connected' state
    const justConnected =
      prevStatus.current !== "connected" && status === "connected"
    prevStatus.current = status

    // Trigger login when freshly connected
    if (justConnected && !hasAttemptedLogin.current) {
      hasAttemptedLogin.current = true
      setTimeout(() => {
        // Re-check at fire time: the session may have recovered during the
        // delay (cookie reconcile / a concurrent login). Skip the redundant
        // signature prompt if we're already logged in.
        if (isLoggedInCookiePresent()) return
        login()
      }, 300)
      return
    }

    // Re-login when auth is lost while still connected (e.g. 401 refresh failure)
    if (
      status === "connected" &&
      !isAuthenticated &&
      !hasAttemptedLogin.current &&
      isAuthReady &&
      !isRefreshing
    ) {
      hasAttemptedLogin.current = true
      setTimeout(() => {
        if (isLoggedInCookiePresent()) return
        login()
      }, 500)
    }
  }, [status, isAuthenticated, isRefreshing, isAuthReady, login])

  // Auto-login when account is switched (after logout completes)
  useEffect(() => {
    if (
      accountSwitched &&
      status === "connected" &&
      !isAuthenticated &&
      !isLoggingIn
    ) {
      clearAccountSwitched()
      // Small delay to ensure logout is fully processed
      setTimeout(() => {
        login()
      }, 300)
    }
  }, [
    accountSwitched,
    status,
    isAuthenticated,
    isLoggingIn,
    login,
    clearAccountSwitched,
  ])

  // (Wake-from-sleep handling: we deliberately do NOT auto-open the wallet
  // modal here. The page itself stays viewable — chart, orderbook, market
  // stats are all public data — and the header keeps a visible "Connect
  // Wallet" button. The user can re-authenticate when they want to trade,
  // without being interrupted by a forced modal the moment they refocus
  // the tab.)

  return (
    <>
      <header className="relative flex items-center justify-between border-b border-border bg-card px-6 py-3 max-[850px]:px-4">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-1.5">
            <Image
              src="/icons/logo/el_perps.svg"
              alt="Elysia Perps"
              width={125}
              height={22}
              className="h-auto w-[125px] cursor-pointer"
            />
            {/* BETA badge — Figma node 2480:15249 */}
            <span className="rounded-[3px] border-[0.5px] border-[#4eacff] px-1 py-0.5 text-[8px] font-medium leading-none tracking-[-0.08px] text-[#49aaff]">
              BETA
            </span>
          </div>

          <nav className="flex items-center gap-6 max-[850px]:hidden">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors ${
                  isNavActive(item.href, pathname)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Dev tools (QA-only) */}
          <DevToolbar />

          {/* Docs link — desktop only; mobile gets its own entry in the
              hamburger menu (different guide URL) */}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="max-[850px]:hidden"
          >
            <a
              href={GUIDE_URLS.desktop}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GuideIcon />
              Guide
            </a>
          </Button>

          {/* Wallet connect / address popover */}
          <div
            {...(!mounted && {
              "aria-hidden": true,
              style: {
                opacity: 0,
                pointerEvents: "none",
                userSelect: "none",
              },
            })}
          >
            {!mounted || !isConnected || !address ? (
              <Button size="sm" variant="outline" onClick={() => open()}>
                Connect Wallet
              </Button>
            ) : (
              <>
                {SHOW_TEST_UI && evmAddress && (
                  <MintButton address={evmAddress as `0x${string}`} />
                )}
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline" disabled={isLoggingIn}>
                      {isLoggingIn ? "Signing..." : formatAddress(address)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-64 p-3">
                    <div className="flex flex-col gap-1">
                      <div className="mb-1 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Wallet Balance
                          </span>
                          <span>
                            {/* Wallet Balance is the on-chain token amount →
                                bare token unit (EL), not the EL$ quote unit. */}
                            {formattedWalletBalance}{" "}
                            {selectedPair.quote.replace(/\$$/, "")}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">
                            Available
                          </span>
                          <span>
                            {formattedPerpBalance} {selectedPair.quote}
                          </span>
                        </div>
                      </div>
                      <div className="my-1 border-t border-border" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2"
                        onClick={() => {
                          setPopoverOpen(false)
                          setDepositOpen(true)
                        }}
                        // On-chain Solana deposit — needs a connected wallet,
                        // not an authenticated backend session.
                        disabled={!isConnected}
                      >
                        <ArrowDownToLine className="h-4 w-4" />
                        Deposit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2"
                        onClick={() => {
                          setPopoverOpen(false)
                          handleWithdraw()
                        }}
                        disabled={!isAuthenticated}
                      >
                        <ArrowUpFromLine className="h-4 w-4" />
                        Withdraw
                      </Button>
                      <div className="my-1 border-t border-border" />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2 text-destructive hover:text-destructive"
                        onClick={() => {
                          setPopoverOpen(false)
                          disconnect()
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                        Disconnect
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className="hidden h-9 w-9 max-[850px]:inline-flex"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            <span className="relative block h-4 w-5">
              <span
                className={`absolute left-0 right-0 h-0.5 rounded-full bg-current transition-all duration-300 ease-in-out ${
                  mobileMenuOpen
                    ? "top-1/2 -translate-y-1/2 rotate-45"
                    : "top-0"
                }`}
              />
              <span
                className={`absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-current transition-opacity duration-200 ${
                  mobileMenuOpen ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 right-0 h-0.5 rounded-full bg-current transition-all duration-300 ease-in-out ${
                  mobileMenuOpen
                    ? "top-1/2 -translate-y-1/2 -rotate-45"
                    : "bottom-0"
                }`}
              />
            </span>
          </Button>
        </div>

        {/* Mobile dropdown menu — uses grid-rows trick for smooth open/close */}
        <div
          className={`absolute inset-x-0 top-full z-40 grid overflow-hidden bg-card transition-[grid-template-rows,opacity] duration-300 ease-out min-[851px]:hidden ${
            mobileMenuOpen
              ? "grid-rows-[1fr] border-b border-border opacity-100 shadow-lg"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <nav className="overflow-hidden">
            <div className="flex flex-col">
              {NAV_ITEMS.map((item) => (
                <Fragment key={item.href}>
                  <Link
                    href={item.href}
                    className={`border-b border-border/50 px-6 py-4 text-base font-semibold transition-colors last:border-b-0 ${
                      isNavActive(item.href, pathname)
                        ? "text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                  {/* Guide sits right below Trade, styled exactly like the
                      menu rows (external link to the mobile user guide) */}
                  {item.href === "/trade" && (
                    <a
                      href={GUIDE_URLS.mobile}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 border-b border-border/50 px-6 py-4 text-base font-semibold text-muted-foreground transition-colors last:border-b-0 hover:bg-muted/40 hover:text-foreground"
                    >
                      Guide
                      <ArrowUpRight className="size-4" />
                    </a>
                  )}
                </Fragment>
              ))}
            </div>
          </nav>
        </div>
      </header>

      {/* Solana deposit/withdraw (devnet vault program). Opened by the header
          "Deposit"/"Withdraw" buttons via the shared store. The EVM
          Deposit/Withdraw modals are not rendered on this Solana-only build. */}
      <SolanaDepositModal open={depositOpen} onOpenChange={setDepositOpen} />
      <SolanaWithdrawModal open={withdrawOpen} onOpenChange={setWithdrawOpen} />

      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        onTryAgain={() => open()}
      />
    </>
  )
}
