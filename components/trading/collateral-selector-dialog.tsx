"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"
import { useConnection, useReadContract } from "wagmi"
import { erc20Abi, formatUnits } from "viem"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { EcosystemLogo } from "@/components/trading/ecosystem-logo"
import { useMarketStore, useSelectedPair } from "@/lib/stores"
import { useMintToken } from "@/lib/hooks/useMintToken"
import { useSolBalance } from "@/lib/solana/useSolBalance"
import { MEME_ASSET_ID } from "@/lib/solana/meme"
import {
  ACTIVE_COLLATERAL_ASSET_IDS,
  ASSET_ID_TO_CHAIN_ID,
  CONTRACTS,
  getTokenAddress,
} from "@/lib/contracts/addresses"
import { PRIMARY_CHAIN_ID } from "@/lib/constants/network"
import {
  ECOSYSTEMS,
  isPairRoutable,
  type Ecosystem,
} from "@/lib/config/markets"
import { tradingToast } from "@/lib/utils/toast"

/**
 * On-chain WALLET balance of an ecosystem's collateral token, read from the
 * chain that actually hosts it (EL → Sepolia, USDC → Giwa Sepolia, …). Each
 * live row reads its own balance — the old single-read-for-current-quote
 * approach couldn't show amounts on the other selectable rows, and read
 * `decimals` from the primary chain even for tokens living elsewhere (which
 * would misformat 6-decimal USDC by ~10^12).
 */
function useEcoWalletAmount(eco: Ecosystem, enabled: boolean): string | null {
  // MEME is a Solana SPL token — its wallet balance comes from the Solana
  // side, not an EVM erc20 read (which would fall back to a Sepolia token).
  const { data: spyderBalance } = useSolBalance()
  const { address } = useConnection()
  const assetId = eco.quoteAssetId
  const chainId =
    assetId != null
      ? (ASSET_ID_TO_CHAIN_ID[assetId] ?? PRIMARY_CHAIN_ID)
      : PRIMARY_CHAIN_ID
  const tokenAddress =
    assetId != null
      ? (getTokenAddress(chainId, assetId) ??
        CONTRACTS[chainId]?.collateralToken)
      : undefined
  const { decimals } = useMintToken(tokenAddress, chainId)
  const { data: walletBalance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: enabled && !!address && !!tokenAddress },
  })
  if (assetId === MEME_ASSET_ID) {
    return spyderBalance != null
      ? spyderBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : null
  }
  if (walletBalance == null) return null
  return parseFloat(formatUnits(walletBalance, decimals ?? 18)).toLocaleString(
    "en-US",
    { maximumFractionDigits: 2 }
  )
}

interface Props {
  trigger: React.ReactNode
}

/**
 * Collateral (deposit token) picker — Figma node 2236-1528. Lists every
 * ecosystem's collateral token; a token is selectable only when the current
 * market's base actually has a live pair quoted in it (so on mainnet, where
 * only EL pairs exist, EL is the sole live option and the rest read "Soon").
 * Selecting a live collateral routes to the same base market under that quote.
 */
export function CollateralSelectorDialog({ trigger }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const pair = useSelectedPair()
  const pairs = useMarketStore((s) => s.pairs)

  const currentQuote = pair.quote_currency
  const base = pair.base.toUpperCase()

  // A collateral is selectable when the network config says it's active
  // (ACTIVE_COLLATERAL_ASSET_IDS — mainnet: EL only; testnet: EL + USDT per
  // ELP-499; retired USDC/ARB read "Soon"), isPairRoutable allows it for
  // this base (testnet USDT is scoped to USDKRW — BTC-PERP-USDT still
  // exists on dev but is retired), and a live pair actually exists.
  const isLiveFor = (eco: (typeof ECOSYSTEMS)[number]) =>
    eco.quoteAssetId != null &&
    ACTIVE_COLLATERAL_ASSET_IDS.includes(eco.quoteAssetId) &&
    isPairRoutable(base, eco.quoteAssetId) &&
    pairs.some(
      (p) =>
        p.base.toUpperCase() === base && p.quote_currency === eco.quoteAssetId
    )

  // Order: current collateral first, then other live tokens, then "Soon".
  // (Figma leads with the selected token; the array's own order is otherwise
  // preserved within each group.)
  const ordered = [...ECOSYSTEMS].sort((a, b) => {
    const rank = (eco: (typeof ECOSYSTEMS)[number]) =>
      eco.quoteAssetId != null && eco.quoteAssetId === currentQuote
        ? 0
        : isLiveFor(eco)
          ? 1
          : 2
    return rank(a) - rank(b)
  })

  const handleSelect = (eco: (typeof ECOSYSTEMS)[number]) => {
    // Same-collateral tap just closes.
    if (eco.quoteAssetId != null && eco.quoteAssetId === currentQuote) {
      setOpen(false)
      return
    }
    // Only enabled collateral routes; the rest (incl. testnet ARB/USDT that do
    // have pairs) fall through to the "Soon" toast.
    if (isLiveFor(eco)) {
      const resolved = pairs.find(
        (p) =>
          p.base.toUpperCase() === base && p.quote_currency === eco.quoteAssetId
      )
      if (resolved) {
        router.replace(`/trade/${resolved.name}`)
        setOpen(false)
        return
      }
    }
    tradingToast.info(
      "Coming soon",
      `${eco.collateralToken} (${eco.name}) is not yet available as collateral.`
    )
  }

  return (
    // `modal`: same iframe caveat as MarketSelectorDialog — clicks landing on
    // the TradingView chart iframe are invisible to non-modal outside-click
    // detection, leaving the popover stuck open.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[320px] overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-xl"
      >
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-[#0086fc]">
            Trade with any token
          </div>
          <div className="text-xs text-muted-foreground">
            Deposit any asset as collateral
          </div>
        </div>
        <ul className="max-h-[400px] overflow-y-auto py-1">
          {ordered.map((eco) => (
            <CollateralRow
              key={eco.id}
              eco={eco}
              isCurrent={
                eco.quoteAssetId != null && eco.quoteAssetId === currentQuote
              }
              isLive={isLiveFor(eco)}
              onSelect={() => handleSelect(eco)}
            />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One collateral row. Split out so each live row can call the wallet-balance
 * hook for ITS OWN chain (hooks can't run inside `.map`) — this is what lets
 * the USDC row show the user's Giwa Sepolia MockUSDC balance next to the EL
 * row's Sepolia balance.
 */
function CollateralRow({
  eco,
  isCurrent,
  isLive,
  onSelect,
}: {
  eco: Ecosystem
  isCurrent: boolean
  isLive: boolean
  onSelect: () => void
}) {
  // Read only for rows the user can actually act on; "Soon" rows skip the RPC.
  const amount = useEcoWalletAmount(eco, isCurrent || isLive)
  return (
    <li>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 ${
          isLive || isCurrent ? "cursor-pointer" : "cursor-default opacity-60"
        }`}
      >
        <EcosystemLogo ecosystem={eco} size={28} />
        <span className="flex min-w-0 flex-col">
          {/* Selected collateral shows in its own brand color
              (EL = blue), not a generic accent — Figma 2236-1528. */}
          <span
            className={`text-sm font-semibold ${
              isCurrent ? "" : "text-foreground"
            }`}
            style={isCurrent ? { color: eco.color } : undefined}
          >
            {eco.collateralToken}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {eco.name}
          </span>
        </span>
        {/* Right side: held balance ("✓ 1,000 EL" when selected — brand check
            + amount; live-but-unselected rows show their own chain's wallet
            balance), else "Soon" for disabled tokens. */}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-sm">
          {isCurrent ? (
            <>
              <Check className="h-4 w-4" style={{ color: eco.color }} />
              <span className="font-mono text-foreground">
                {amount ?? "0"} {eco.collateralToken}
              </span>
            </>
          ) : isLive ? (
            <span className="font-mono text-foreground">
              {amount ?? "0"} {eco.collateralToken}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/70">Soon</span>
          )}
        </span>
      </button>
    </li>
  )
}
