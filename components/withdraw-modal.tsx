"use client"

import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  startTransition,
} from "react"
import { useReadContract } from "wagmi"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import {
  ASSET_ID_TO_CHAIN_ID,
  ACTIVE_COLLATERAL_ASSET_IDS,
  getTokenAddress,
  getTokensPerDollar,
} from "@/lib/contracts/addresses"
import { MockTokenAbi } from "@/lib/contracts/abi/MockTokenAbi"
import { useBalance } from "@/lib/hooks/useBalance"
import { useWithdraw } from "@/lib/hooks/useWithdraw"
import { useAmountInput } from "@/lib/hooks/useAmountInput"
import { trackWithdraw } from "@/lib/analytics/ga"
import { tradingToast } from "@/lib/utils/toast"
import { useHistoryTabStore } from "@/lib/stores"
import { ASSET_IDS } from "@/lib/constants/assets"
import { getAssetName } from "@/lib/utils"
import {
  TokenPickerPopover,
  type TokenPickerItem,
} from "@/components/trading/token-picker-popover"
import { ReceivePanel } from "@/components/trading/receive-panel"

interface WithdrawModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: `0x${string}`
}

export function WithdrawModal({
  open,
  onOpenChange,
  address,
}: WithdrawModalProps) {
  const { amount, setAmount, handleAmountChange } = useAmountInput(4)
  const [selectedAssetId, setSelectedAssetId] = useState<number>(ASSET_IDS.EL)
  const setActiveTab = useHistoryTabStore((s) => s.setActiveTab)

  // --- Read: perp balance from API ---
  const { data: balanceData } = useBalance()

  // Tokens the account holds, narrowed to the actively-offered collaterals
  // (EL + USDC — USDT/ARB are retired from the product and hidden here
  // regardless of balance; see ACTIVE_COLLATERAL_ASSET_IDS).
  const tokenIds = useMemo(
    () =>
      (balanceData?.balances ?? [])
        .filter((b) => ACTIVE_COLLATERAL_ASSET_IDS.includes(b.asset_id))
        .map((b) => b.asset_id),
    [balanceData]
  )
  // Keep the selection valid once balances arrive.
  useEffect(() => {
    if (tokenIds.length && !tokenIds.includes(selectedAssetId)) {
      setSelectedAssetId(tokenIds[0])
    }
  }, [tokenIds, selectedAssetId])
  // Withdraw the collateral (e.g. "EL$") and receive the bare wallet token
  // ("EL"). Input side uses `tokenSymbol`, the "you receive" side `walletSymbol`.
  const tokenSymbol = getAssetName(selectedAssetId)
  const walletSymbol = tokenSymbol.replace(/\$$/, "")

  // Reverse of deposit: collateral units → wallet tokens at the server's
  // per-token rate (EL 100:1, ARB 10:1, USDT/USDC 1:1). See TOKENS_PER_DOLLAR
  // in lib/contracts/addresses.
  const tokensPerDollar = getTokensPerDollar(selectedAssetId)
  const receiveEl = useMemo(() => {
    const n = parseFloat(amount)
    if (!Number.isFinite(n) || n <= 0) return 0
    return n * tokensPerDollar
  }, [amount, tokensPerDollar])
  const receiveDisplay = receiveEl.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })
  // 1 EL$ ≈ $1, so the USD value equals the EL$ amount being withdrawn.
  const receiveUsdDisplay = (parseFloat(amount) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })

  // The on-chain wallet balance lives on whichever chain owns this token —
  // ARB lives on Arbitrum Sepolia, EL/USDT on Sepolia. We don't *need* the
  // value here; we just need a refetch handle to nudge the header pill
  // after the server reports a successful withdrawal.
  const tokenChainId = ASSET_ID_TO_CHAIN_ID[selectedAssetId] ?? undefined
  const tokenAddress = tokenChainId
    ? getTokenAddress(tokenChainId, selectedAssetId)
    : undefined

  const { refetch: refetchWalletBalance } = useReadContract({
    address: tokenAddress,
    abi: MockTokenAbi,
    functionName: "balanceOf",
    args: [address],
    chainId: tokenChainId,
    query: { enabled: !!address && !!tokenAddress },
  })

  // --- Withdraw mutation (API call) ---
  const {
    mutate: withdraw,
    isPending: isWithdrawPending,
    isSuccess: isWithdrawSuccess,
    error: withdrawError,
    reset: resetWithdraw,
  } = useWithdraw()

  // --- Computed values ---
  const perpAvailable = useMemo(() => {
    const balance = balanceData?.balances?.find(
      (b) => b.asset_id === selectedAssetId
    )
    return balance ? parseFloat(balance.available) : 0
  }, [balanceData, selectedAssetId])

  const formattedPerpBalance = useMemo(() => {
    return (Math.floor(perpAvailable * 100) / 100).toFixed(2)
  }, [perpAvailable])

  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(Number(amount))) return null
    const num = parseFloat(amount)
    if (num <= 0) return null
    return num
  }, [amount])

  const isInsufficientBalance = useMemo(() => {
    if (parsedAmount == null) return false
    return parsedAmount > perpAvailable
  }, [parsedAmount, perpAvailable])

  const isValidAmount = useMemo(() => {
    return parsedAmount != null && parsedAmount > 0
  }, [parsedAmount])

  const handleMax = useCallback(() => {
    if (perpAvailable <= 0) return
    const raw = perpAvailable.toString()
    const dotIdx = raw.indexOf(".")
    const truncated = dotIdx === -1 ? raw : raw.slice(0, dotIdx + 5)
    setAmount(truncated)
  }, [perpAvailable, setAmount])

  // --- Withdraw action (API call) ---
  const handleWithdraw = useCallback(() => {
    if (!isValidAmount) return

    withdraw(
      { asset_id: selectedAssetId, amount },
      {
        onSuccess: () => {
          onOpenChange(false)
          setActiveTab("withdrawals")
          tradingToast.withdrawSuccess(amount, tokenSymbol)
          trackWithdraw({ amount, token: tokenSymbol })
          // Refetch wallet balance after a short delay (server processes in background)
          setTimeout(() => {
            refetchWalletBalance()
          }, 5000)
        },
        onError: (error) => {
          tradingToast.withdrawFailed(
            error instanceof Error ? error.message.split("\n")[0] : undefined
          )
        },
      }
    )
  }, [
    amount,
    selectedAssetId,
    tokenSymbol,
    isValidAmount,
    withdraw,
    refetchWalletBalance,
    onOpenChange,
    setActiveTab,
  ])

  // --- Reset state when modal closes ---
  useEffect(() => {
    if (!open) {
      startTransition(() => setAmount(""))
      resetWithdraw()
    }
  }, [open, resetWithdraw])

  // Picker rows: held collaterals with their withdrawable (perp-account)
  // balance — the number that matters when picking what to pull out.
  const pickerItems = useMemo<TokenPickerItem[]>(
    () =>
      tokenIds.map((id) => {
        const available = balanceData?.balances?.find(
          (b) => b.asset_id === id
        )?.available
        return {
          assetId: id,
          label: getAssetName(id),
          meta:
            available != null
              ? (Math.floor(parseFloat(available) * 100) / 100).toFixed(2)
              : "-",
          metaClassName: "font-mono",
        }
      }),
    [tokenIds, balanceData]
  )

  // --- Button ---
  const buttonText = useMemo(() => {
    if (isInsufficientBalance) return "Insufficient Balance"
    return "Withdraw"
  }, [isInsufficientBalance])

  const isButtonDisabled =
    !isValidAmount || isInsufficientBalance || isWithdrawPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] gap-4 rounded-2xl border-[#2e2e2e] bg-[#1a1a1a]">
        <DialogHeader>
          <DialogTitle className="text-lg">Withdraw</DialogTitle>
          <DialogDescription className="sr-only">
            Withdraw {tokenSymbol} from your perp account
          </DialogDescription>
        </DialogHeader>

        {isWithdrawPending ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <div className="text-center text-sm text-muted-foreground">
              Processing withdrawal...
            </div>
          </div>
        ) : (
          // Spacing mirrors the Figma rhythm (node 2276-9136, same as the
          // Deposit modal): input block packed tight, 24px breather before
          // the CTA.
          <div className="flex flex-col">
            {/* Max + available collateral (right-aligned, above the input) */}
            <div className="mb-1 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={handleMax}
                className="cursor-pointer font-medium text-[#0086fc] hover:text-[#0086fc]/80"
              >
                Max
              </button>
              <span className="text-muted-foreground">
                Available{" "}
                <span className="font-mono text-foreground">
                  {formattedPerpBalance} {tokenSymbol}
                </span>
              </span>
            </div>

            {/* Amount input + token chip (the collateral being withdrawn) */}
            <div className="flex h-11 items-center gap-2 rounded-sm border border-[#222] pl-3 pr-1.5">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent font-mono text-lg outline-none placeholder:text-muted-foreground"
              />
              <TokenPickerPopover
                items={pickerItems}
                selectedAssetId={selectedAssetId}
                triggerLabel={tokenSymbol}
                disabled={isWithdrawPending}
                onSelect={setSelectedAssetId}
              />
            </div>

            {/* You receive (wallet tokens). 1:1 collaterals skip the rate row. */}
            <ReceivePanel
              amountDisplay={receiveDisplay}
              symbol={walletSymbol}
              usdDisplay={receiveUsdDisplay}
              rateText={
                tokensPerDollar !== 1
                  ? `1 ${tokenSymbol} = ${tokensPerDollar} ${walletSymbol}`
                  : null
              }
            />

            {/* Security notice — every withdrawal goes through review */}
            <div className="mt-3 flex items-start gap-2.5 rounded-md bg-[#0086fc]/8 px-3 py-2.5 text-xs">
              <span className="font-medium text-[#0086fc]">ⓘ</span>
              <span className="text-muted-foreground">
                Every withdrawal is reviewed to keep your funds safe. Processing
                can take up to{" "}
                <span className="font-medium text-foreground">48 hours.</span>
              </span>
            </div>

            {/* Error messages */}
            {withdrawError && (
              <p className="mt-3 text-xs text-destructive">
                Withdraw failed:{" "}
                {withdrawError instanceof Error
                  ? withdrawError.message.split("\n")[0]
                  : "Unknown error"}
              </p>
            )}

            {/* Withdraw success */}
            {isWithdrawSuccess && (
              <p className="mt-3 text-xs text-success">
                Withdraw requested! Tokens will be sent to your wallet shortly.
              </p>
            )}

            {/* Withdraw CTA */}
            <Button
              className="mt-6 h-11 w-full rounded-md bg-[#0086fc] text-white hover:bg-[#0086fc]/90"
              disabled={isButtonDisabled}
              onClick={handleWithdraw}
            >
              {buttonText}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
