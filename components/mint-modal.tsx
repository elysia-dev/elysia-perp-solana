"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useChainId, useReadContract, useSwitchChain } from "wagmi"
import { PRIMARY_CHAIN_ID } from "@/lib/constants/network"
import { formatUnits } from "viem"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { MockTokenAbi } from "@/lib/contracts/abi/MockTokenAbi"
import {
  ASSET_ID_TO_CHAIN_ID,
  COLLATERAL_TOKENS,
  ACTIVE_COLLATERAL_ASSET_IDS,
  getTokenAddress,
} from "@/lib/contracts/addresses"
import { ASSET_IDS } from "@/lib/constants/assets"
import { getAssetName } from "@/lib/utils"
import { useMintToken } from "@/lib/hooks/useMintToken"
import { useAmountInput } from "@/lib/hooks/useAmountInput"
import { TokenSelect } from "@/components/trading/token-select"
import { tradingToast } from "@/lib/utils/toast"
import { useSelectedPair } from "@/lib/stores"

interface MintModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: `0x${string}`
}

const DEFAULT_AMOUNT = "1000"
const DISPLAY_DECIMALS = 6

export function MintModal({ open, onOpenChange, address }: MintModalProps) {
  // Mintable assets across *all* supported chains (multi-chain, ELP-230).
  // The wallet may currently be on a different chain than the selected
  // token — we surface a switch-network CTA below in that case.
  const tokenIds = useMemo(
    () =>
      Object.values(COLLATERAL_TOKENS)
        .flat()
        .map((t) => t.assetId)
        // Only actively-offered collaterals (EL + USDC) get a faucet entry;
        // retired ones (USDT/ARB) stay in the registry for history display.
        .filter((id) => ACTIVE_COLLATERAL_ASSET_IDS.includes(id)),
    []
  )

  // Default the picker to the *currently-traded market's* quote token,
  // not a hardcoded EL fallback. Background: prior to this, opening Mint
  // on a BTC-PERP-ARB chart with an Arbitrum-Sepolia wallet defaulted
  // the picker to EL (Sepolia). Because the wallet was on the wrong
  // chain for EL, the modal flipped into "Switch network & mint" mode —
  // user clicks it expecting to mint ARB on the chain they're already
  // on, but instead gets bounced to Sepolia and (if they confirm in the
  // wallet) credited with EL they didn't ask for. The match-the-market
  // default makes the common case (top up the collateral I'm trading)
  // one-click, and only diverges from the wallet's chain when the user
  // explicitly switches markets to a different collateral.
  const pair = useSelectedPair()
  const initialAssetId = tokenIds.includes(pair.quote_currency)
    ? pair.quote_currency
    : ASSET_IDS.EL
  const [selectedAssetId, setSelectedAssetId] = useState<number>(initialAssetId)

  // Re-sync the picker to the current market every time the modal opens.
  // Without this the default only "took" on the first ever mount —
  // re-opening Mint after a market switch would keep stale state.
  useEffect(() => {
    if (open) {
      setSelectedAssetId(
        tokenIds.includes(pair.quote_currency)
          ? pair.quote_currency
          : ASSET_IDS.EL
      )
    }
  }, [open, pair.quote_currency, tokenIds])

  const { amount, setAmount, handleAmountChange } = useAmountInput(
    DISPLAY_DECIMALS,
    DEFAULT_AMOUNT
  )

  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [isSwitchingChain, setIsSwitchingChain] = useState(false)

  // Which chain hosts this token? Fall back to whatever the wallet is on
  // so the read still resolves to *something* for unknown asset ids.
  const targetChainId = ASSET_ID_TO_CHAIN_ID[selectedAssetId] ?? walletChainId
  const isWrongChain = walletChainId !== targetChainId

  const tokenAddress =
    getTokenAddress(targetChainId, selectedAssetId) ??
    COLLATERAL_TOKENS[targetChainId]?.[0]?.address ??
    COLLATERAL_TOKENS[PRIMARY_CHAIN_ID][0].address
  const tokenSymbol = getAssetName(selectedAssetId)

  const { mint, isPending, isConfirming, isSuccess, decimals, error, reset } =
    useMintToken(tokenAddress, targetChainId)

  const { data: walletBalance, refetch: refetchWalletBalance } =
    useReadContract({
      address: tokenAddress,
      abi: MockTokenAbi,
      functionName: "balanceOf",
      args: [address],
      chainId: targetChainId,
      query: { enabled: !!address },
    })

  const d = decimals ?? 18

  const formattedBalance = useMemo(() => {
    if (walletBalance == null) return "-"
    const num = parseFloat(formatUnits(walletBalance, d))
    if (isNaN(num)) return "-"
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: DISPLAY_DECIMALS,
    })
  }, [walletBalance, d])

  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(Number(amount))) return null
    const num = parseFloat(amount)
    return num > 0 ? num : null
  }, [amount])

  const isBusy = isPending || isConfirming || isSwitchingChain
  const isValid = parsedAmount != null && !isBusy

  const handleMint = useCallback(async () => {
    if (parsedAmount == null || decimals == null) return

    // If the wallet is on the wrong chain, switch first. Wagmi's
    // useWriteContract will otherwise reject with a chain-mismatch
    // error before the wallet even prompts the user.
    if (isWrongChain) {
      try {
        setIsSwitchingChain(true)
        await switchChainAsync({ chainId: targetChainId })
      } catch {
        tradingToast.error(
          "Network switch declined",
          `Switch to chain ${targetChainId} to mint ${tokenSymbol}.`
        )
        return
      } finally {
        setIsSwitchingChain(false)
      }
    }

    mint(address, amount)
  }, [
    parsedAmount,
    decimals,
    isWrongChain,
    switchChainAsync,
    targetChainId,
    tokenSymbol,
    mint,
    address,
    amount,
  ])

  // --- Success: start cooldown, refresh, toast, close ---
  const successHandledRef = useRef(false)
  useEffect(() => {
    if (!isSuccess || successHandledRef.current) return
    successHandledRef.current = true
    refetchWalletBalance()
    tradingToast.success("Mint complete", `Minted ${amount} ${tokenSymbol}`)
    onOpenChange(false)
  }, [isSuccess, amount, tokenSymbol, refetchWalletBalance, onOpenChange])

  // --- Wallet rejection / failure ---
  useEffect(() => {
    if (!error) return
    const isUserRejected =
      error.message.includes("User denied") ||
      error.message.includes("User rejected")
    tradingToast.error(
      "Mint failed",
      isUserRejected ? "Mint was declined" : "Mint failed. Please try again."
    )
    onOpenChange(false)
  }, [error, onOpenChange])

  // --- Reset write state when modal closes ---
  useEffect(() => {
    if (!open) {
      setAmount(DEFAULT_AMOUNT)
      reset()
      successHandledRef.current = false
    }
  }, [open, reset, setAmount])

  const buttonText = useMemo(() => {
    if (isBusy) return null
    if (isWrongChain) return "Switch network & mint"
    return "Mint"
  }, [isBusy, isWrongChain])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mint Test Tokens</DialogTitle>
          <DialogDescription className="sr-only">
            Mint test {tokenSymbol} to your wallet
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Mint Token */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Mint Token</span>
            <TokenSelect
              assetIds={tokenIds}
              value={selectedAssetId}
              onValueChange={setSelectedAssetId}
              className="h-8"
            />
          </div>

          {/* Wallet Balance */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Wallet Balance</span>
            <span>
              {formattedBalance} {tokenSymbol}
            </span>
          </div>

          {/* Amount Input */}
          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={handleAmountChange}
              placeholder={`0.${"0".repeat(DISPLAY_DECIMALS)}`}
              className="h-12 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            />
          </div>

          {/* Mint Button */}
          <Button className="w-full" disabled={!isValid} onClick={handleMint}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : buttonText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
