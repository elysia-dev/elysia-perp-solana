"use client"

import { useMemo } from "react"
import { useConnection, useReadContract } from "wagmi"
import { erc20Abi, formatUnits } from "viem"
import { useBalance } from "@/lib/hooks/useBalance"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useElPrice } from "@/lib/hooks/useElPrice"
import { useSelectedPair } from "@/lib/stores"
import { getAssetName } from "@/lib/utils"
import { PRIMARY_CHAIN_ID } from "@/lib/constants/network"
import {
  CONTRACTS,
  getTokenAddress,
  ASSET_ID_TO_CHAIN_ID,
} from "@/lib/contracts/addresses"

// Account Equity comes from the account balance + unrealized PnL; the
// Collateral row shows the on-chain WALLET balance of the collateral token;
// EL Price is the live market price (CoinGecko via /api/el-price) (Figma
// 2299-5756).
// Fallback market price until the first CoinGecko response lands.
const EL_PRICE_FALLBACK = 0.01

// ADL risk (estimate). ADL de-leverages the most PROFITABLE, high-leverage
// positions first, so the ranking score is ~ profit% × leverage — which equals
// ROE (unrealized PnL / margin). The true queue position needs the whole book
// (all users' scores), which the client doesn't have, so this is an OWN-account
// approximation banded into Low/Medium/High. Losses / no position → Low.
// Thresholds are ROE fractions (1.0 = +100% on margin); tune freely.
const ADL_MED_ROE = 1.0
const ADL_HIGH_ROE = 3.0

function fmt(v: number, maxDp = 2): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDp,
  })
}

export function TradingAccountCard() {
  const pair = useSelectedPair()
  const { data: balanceData } = useBalance()
  const positions = usePositionsList()
  const { data: elPrice } = useElPrice()

  const elUsd = elPrice?.usd ?? EL_PRICE_FALLBACK
  const elChange = elPrice?.usd_24h_change ?? 0
  const elChangeUp = elChange >= 0

  // Account-wide ADL exposure = the riskiest open position's score.
  const adl = useMemo(() => {
    let score = 0
    for (const p of positions) {
      const pnl = parseFloat(p.unrealized_pnl) || 0
      const margin = parseFloat(p.margin) || 0
      if (pnl > 0 && margin > 0) score = Math.max(score, pnl / margin)
    }
    // `warning` isn't in the theme; #f5a623 is the app's amber (chart liq color).
    if (score >= ADL_HIGH_ROE)
      return {
        level: "High",
        lit: 3,
        color: "text-destructive",
        dot: "bg-destructive",
      }
    if (score >= ADL_MED_ROE)
      return {
        level: "Medium",
        lit: 2,
        color: "text-[#f5a623]",
        dot: "bg-[#f5a623]",
      }
    return { level: "Low", lit: 1, color: "text-success", dot: "bg-success" }
  }, [positions])

  const quoteSymbol = getAssetName(pair.quote_currency) // e.g. "EL$"
  const collateralToken = quoteSymbol.replace(/\$$/, "") // e.g. "EL"

  // On-chain wallet balance of the collateral token (shown on the Collateral
  // row per design — the EL the user holds in their wallet, NOT the deposited
  // account collateral). Pinned to the token's own chain like the header.
  const { address } = useConnection()
  const quoteChainId =
    ASSET_ID_TO_CHAIN_ID[pair.quote_currency] ?? PRIMARY_CHAIN_ID
  const tokenAddress =
    getTokenAddress(quoteChainId, pair.quote_currency) ??
    CONTRACTS[quoteChainId]?.collateralToken
  const { data: walletBalanceRaw } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: quoteChainId,
    query: { enabled: !!address && !!tokenAddress, refetchInterval: 5000 },
  })
  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
    chainId: quoteChainId,
    query: { enabled: !!tokenAddress },
  })
  const walletBalance =
    walletBalanceRaw != null
      ? parseFloat(formatUnits(walletBalanceRaw, tokenDecimals ?? 18))
      : 0

  const equity = useMemo(() => {
    const bal = balanceData?.balances?.find(
      (b) => b.asset_id === pair.quote_currency
    )
    // Total collateral (quote unit) = available + margin locked in positions.
    const collateral = bal
      ? (parseFloat(bal.available) || 0) + (parseFloat(bal.locked) || 0)
      : 0
    // Equity = collateral + unrealized PnL of this collateral's positions.
    const pnl = positions
      .filter((p) => p.quote_asset_id === pair.quote_currency)
      .reduce((sum, p) => sum + (parseFloat(p.unrealized_pnl) || 0), 0)
    return collateral + pnl
  }, [balanceData, positions, pair.quote_currency])

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[#222] bg-[#0a0a0a] p-3 text-xs">
      <p className="text-xs font-semibold text-foreground">Trading Account</p>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Account Equity</span>
        <span>
          {fmt(equity)}{" "}
          <span className="text-muted-foreground">{quoteSymbol}</span>
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Collateral</span>
        <span>
          {fmt(walletBalance)}{" "}
          <span className="text-muted-foreground">{collateralToken}</span>
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">EL Price</span>
        <span className="flex items-baseline gap-2">
          <span>${elUsd.toFixed(4)}</span>
          <span className={elChangeUp ? "text-success" : "text-destructive"}>
            {elChangeUp ? "+" : ""}
            {elChange.toFixed(2)}%
          </span>
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-muted-foreground underline decoration-dotted underline-offset-2">
          ADL Risk
        </span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1 w-3 rounded-full ${i < adl.lit ? adl.dot : "bg-muted"}`}
              />
            ))}
          </span>
          <span className={adl.color}>{adl.level}</span>
        </span>
      </div>
    </div>
  )
}
