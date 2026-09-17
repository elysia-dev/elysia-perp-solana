"use client"

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import {
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
  useBlockNumber,
} from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { formatUnits, parseUnits } from "viem"
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
  CONTRACTS,
  COLLATERAL_TOKENS,
  ACTIVE_COLLATERAL_ASSET_IDS,
  ASSET_ID_TO_CHAIN_ID,
  getTokenAddress,
  getTokensPerDollar,
  getMinDepositTokens,
  getDepositConfirmations,
  getBlockTimeMs,
  getChainName,
} from "@/lib/contracts/addresses"
import {
  TokenPickerPopover,
  type TokenPickerItem,
} from "@/components/trading/token-picker-popover"
import { ReceivePanel } from "@/components/trading/receive-panel"
import { useAmountInput } from "@/lib/hooks/useAmountInput"
import { getFeeOverrides } from "@/lib/contracts/gas"
import { MockTokenAbi } from "@/lib/contracts/abi/MockTokenAbi"
import { ElysiaPerpAbi } from "@/lib/contracts/abi/ElysiaPerpAbi"
import { apiClient, ApiError } from "@/lib/api/client"
import { trackDeposit } from "@/lib/analytics/ga"
import { tradingToast } from "@/lib/utils/toast"
import { useHistoryTabStore, useSelectedPair } from "@/lib/stores"
import { usePendingDepositStore } from "@/lib/stores/usePendingDepositStore"
import { DepositStepper, type StepStatus } from "@/components/deposit-stepper"
import { ASSET_IDS } from "@/lib/constants/assets"
import { getAssetName } from "@/lib/utils"
import type { VerifyDepositResponse } from "@/types"

// Input/display precision: 4 decimal places.
const DISPLAY_DECIMALS = 4

interface DepositModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  address: `0x${string}`
}

export function DepositModal({
  open,
  onOpenChange,
  address,
}: DepositModalProps) {
  const queryClient = useQueryClient()
  const { amount, setAmount, handleAmountChange } =
    useAmountInput(DISPLAY_DECIMALS)
  const setActiveTab = useHistoryTabStore((s) => s.setActiveTab)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSwitchingChain, setIsSwitchingChain] = useState(false)

  // Wallet's current chain and a switch helper. We always anchor reads/writes
  // against the chain that owns the selected token (`targetChainId`), not the
  // wallet's current chain — wagmi will refuse a write if the wallet isn't on
  // it, which is what triggers the on-demand switchChain in handleDeposit.
  const walletChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()

  // Collaterals offered for deposit: the cross-chain union (ELP-133 +
  // multi-chain), narrowed to the actively-offered set (EL + USDC — USDT/ARB
  // are retired; see ACTIVE_COLLATERAL_ASSET_IDS). Order: walk the chain map
  // in declaration order so the default-token-on-mount stays predictable.
  const tokenIds = useMemo(
    () =>
      Object.values(COLLATERAL_TOKENS)
        .flatMap((list) => list.map((t) => t.assetId))
        .filter((id) => ACTIVE_COLLATERAL_ASSET_IDS.includes(id)),
    []
  )

  // Default the token picker to the *currently-traded market's* quote
  // collateral instead of a hardcoded EL. Background: opening Deposit on
  // a BTC-PERP-ARB chart used to default to EL, which (a) sits on a
  // different chain (Sepolia) than the user's wallet was almost
  // certainly on (Arbitrum Sepolia for ARB trading), forcing an
  // unexpected "Switch network & deposit" hop, and (b) tops up the
  // wrong collateral even after the switch — the user wanted ARB.
  // Matching the active market lets the common "I'm trading X, top up
  // X" flow proceed without any chain-switch or token-picker fiddling.
  const pair = useSelectedPair()
  const initialAssetId = tokenIds.includes(pair.quote_currency)
    ? pair.quote_currency
    : ASSET_IDS.EL
  const [selectedAssetId, setSelectedAssetId] = useState<number>(initialAssetId)
  // Picker rows: actively-offered collaterals labelled with their host chain
  // (the same USDC could exist on several chains — the chain name is what
  // disambiguates).
  const pickerItems = useMemo<TokenPickerItem[]>(
    () =>
      tokenIds.map((id) => ({
        assetId: id,
        label: getAssetName(id).replace(/\$$/, ""),
        meta: getChainName(ASSET_ID_TO_CHAIN_ID[id]),
      })),
    [tokenIds]
  )

  // Re-sync to the current market each time the modal opens. Otherwise
  // the default only "takes" on the first ever mount — re-opening after
  // switching markets keeps stale state.
  useEffect(() => {
    if (open) {
      setSelectedAssetId(
        tokenIds.includes(pair.quote_currency)
          ? pair.quote_currency
          : ASSET_IDS.EL
      )
    }
  }, [open, pair.quote_currency, tokenIds])

  // The chain that hosts the currently selected collateral. Falls back to the
  // wallet's chain so an unknown token doesn't crash the modal (it just
  // produces an "undefined token address" downstream which the UI handles).
  const targetChainId = ASSET_ID_TO_CHAIN_ID[selectedAssetId] ?? walletChainId
  const isWrongChain = walletChainId !== targetChainId

  const tokenAddress =
    getTokenAddress(targetChainId, selectedAssetId) ??
    COLLATERAL_TOKENS[targetChainId]?.[0]?.address
  const perpAddress = CONTRACTS[targetChainId]?.elysiaPerp
  // Collateral symbol carries the "$" (e.g. "EL$"); the wallet ERC20 token you
  // deposit is the bare symbol ("EL"). The input side uses `walletSymbol`, the
  // "you receive" side uses `tokenSymbol`.
  const tokenSymbol = getAssetName(selectedAssetId)
  const walletSymbol = tokenSymbol.replace(/\$$/, "")

  // Track whether we've already submitted a deposit hash to prevent duplicates
  const submittedHashRef = useRef<string | null>(null)

  // All reads pin `chainId: targetChainId` so they hit the right network
  // even when the wallet is currently on a different one (e.g. user picked
  // ARB while still connected to Sepolia — we want to show their actual ARB
  // balance/allowance immediately, not wait for the switch).
  const { data: decimals } = useReadContract({
    address: tokenAddress,
    abi: MockTokenAbi,
    functionName: "decimals",
    chainId: targetChainId,
    query: { enabled: !!tokenAddress },
  })

  const { data: walletBalance, refetch: refetchWalletBalance } =
    useReadContract({
      address: tokenAddress,
      abi: MockTokenAbi,
      functionName: "balanceOf",
      args: [address],
      chainId: targetChainId,
      query: { enabled: !!address && !!tokenAddress },
    })

  const { data: allowance } = useReadContract({
    address: tokenAddress,
    abi: MockTokenAbi,
    functionName: "allowance",
    args: perpAddress ? [address, perpAddress] : undefined,
    chainId: targetChainId,
    query: { enabled: !!address && !!tokenAddress && !!perpAddress },
  })

  // --- Write: approve ---
  const {
    writeContract: approveWrite,
    data: approveHash,
    isPending: isApprovePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract()

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash })

  // --- Write: deposit ---
  const {
    writeContract: depositWrite,
    data: depositHash,
    isPending: isDepositPending,
    error: depositError,
    reset: resetDeposit,
  } = useWriteContract()

  // Deposit tx receipt — gives the mined block (drives the crediting step's
  // confirmation count) and the "confirming" state for the Deposit step.
  const { data: depositReceipt, isLoading: isDepositConfirming } =
    useWaitForTransactionReceipt({ hash: depositHash })
  const depositBlock = depositReceipt
    ? Number(depositReceipt.blockNumber)
    : undefined

  // Server has acked the mined deposit (verify POST resolved). Marks the
  // Deposit step done and hands off to the crediting step.
  const [depositVerified, setDepositVerified] = useState(false)

  // Block time of the deposit's chain, for the crediting-step ETA
  // (L1 ~12s, Arbitrum Sepolia ~300ms, Giwa Sepolia ~1s).
  const creditBlockTimeMs = getBlockTimeMs(targetChainId)

  const addPendingDeposit = usePendingDepositStore((s) => s.addDeposit)
  const registeredRef = useRef<string | null>(null)

  // Live block number to count confirmations while the deposit is crediting.
  const { data: currentBlock } = useBlockNumber({
    watch: open && depositVerified && depositBlock != null,
  })

  const d = decimals ?? 18

  // --- Computed values ---
  const formattedBalance = useMemo(() => {
    if (walletBalance == null) return "-"
    const raw = formatUnits(walletBalance, d)
    const num = parseFloat(raw)
    if (isNaN(num)) return "-"
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: DISPLAY_DECIMALS,
    })
  }, [walletBalance, d])

  const placeholder = `0.${"0".repeat(DISPLAY_DECIMALS)}`

  const parsedAmount = useMemo(() => {
    if (!amount || isNaN(Number(amount))) return null
    try {
      return parseUnits(amount, d)
    } catch {
      return null
    }
  }, [amount, d])

  const isInsufficientBalance = useMemo(() => {
    if (parsedAmount == null || walletBalance == null) return false
    return parsedAmount > walletBalance
  }, [parsedAmount, walletBalance])

  const needsApproval = useMemo(() => {
    if (parsedAmount == null || allowance == null) return false
    return allowance < parsedAmount
  }, [parsedAmount, allowance])

  // Per-token minimum ($10-equivalent): EL 1,000 / ARB 100 / USDT·USDC 10.
  const minDepositTokens = getMinDepositTokens(selectedAssetId)
  const minDepositDisplay = minDepositTokens.toLocaleString("en-US")

  const isBelowMinimum = useMemo(() => {
    if (!amount || parsedAmount == null) return false
    try {
      const minAmount = parseUnits(String(minDepositTokens), d)
      return parsedAmount < minAmount
    } catch {
      return false
    }
  }, [amount, parsedAmount, d, minDepositTokens])

  const isValidAmount = useMemo(() => {
    if (!amount || parsedAmount == null) return false
    if (parsedAmount <= 0n) return false
    return !isBelowMinimum
  }, [amount, parsedAmount, isBelowMinimum])

  // Deposit converts the wallet token to its perp collateral unit at the
  // server's per-token rate (`rate_num/rate_den`, USD per token): EL 100:1,
  // ARB 10:1, USDT/USDC 1:1. See TOKENS_PER_DOLLAR in lib/contracts/addresses.
  const tokensPerDollar = getTokensPerDollar(selectedAssetId)
  const receiveElDollar = useMemo(() => {
    const n = parseFloat(amount)
    if (!Number.isFinite(n) || n <= 0) return 0
    return n / tokensPerDollar
  }, [amount, tokensPerDollar])
  const receiveDisplay = receiveElDollar.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })
  // 1 EL$ ≈ $1, so the USD figure equals the EL$ amount.
  const receiveUsdDisplay = receiveElDollar.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })

  const isBusy =
    isApprovePending ||
    isApproveConfirming ||
    isDepositPending ||
    isSubmitting ||
    isSwitchingChain

  // --- Input handler: limit decimal places ---
  const handleMax = useCallback(() => {
    if (walletBalance == null) return
    const raw = formatUnits(walletBalance, d)
    const dotIdx = raw.indexOf(".")
    const truncated =
      dotIdx === -1 ? raw : raw.slice(0, dotIdx + DISPLAY_DECIMALS + 1)
    setAmount(truncated)
  }, [walletBalance, d, setAmount])

  // --- Deposit action ---
  const handleDeposit = useCallback(async () => {
    if (parsedAmount == null || decimals == null) return
    if (!tokenAddress || !perpAddress) return

    // Make sure the wallet is on the chain that owns the selected token
    // before we ask it to sign. switchChainAsync rejects with the wallet's
    // standard "user rejected" error if the user declines, which the
    // existing approve/deposit error handler already surfaces.
    if (isWrongChain) {
      try {
        setIsSwitchingChain(true)
        await switchChainAsync({ chainId: targetChainId })
      } catch {
        setIsSwitchingChain(false)
        tradingToast.depositFailed("Network switch was declined")
        return
      } finally {
        setIsSwitchingChain(false)
      }
    }

    const feeOverrides = getFeeOverrides(targetChainId)
    if (needsApproval) {
      approveWrite({
        address: tokenAddress,
        abi: MockTokenAbi,
        functionName: "approve",
        args: [perpAddress, parsedAmount],
        chainId: targetChainId,
        ...feeOverrides,
      })
    } else {
      depositWrite({
        address: perpAddress,
        abi: ElysiaPerpAbi,
        functionName: "deposit",
        args: [tokenAddress, parsedAmount, 0],
        chainId: targetChainId,
        ...feeOverrides,
      })
    }
  }, [
    parsedAmount,
    decimals,
    needsApproval,
    approveWrite,
    depositWrite,
    tokenAddress,
    perpAddress,
    isWrongChain,
    switchChainAsync,
    targetChainId,
  ])

  // --- Auto-trigger deposit after approve success ---
  useEffect(() => {
    if (
      isApproveSuccess &&
      parsedAmount != null &&
      decimals != null &&
      perpAddress &&
      tokenAddress
    ) {
      depositWrite({
        address: perpAddress,
        abi: ElysiaPerpAbi,
        functionName: "deposit",
        args: [tokenAddress, parsedAmount, 0],
        chainId: targetChainId,
        ...getFeeOverrides(targetChainId),
      })
    }
  }, [
    isApproveSuccess,
    parsedAmount,
    decimals,
    depositWrite,
    perpAddress,
    tokenAddress,
    targetChainId,
  ])

  // --- POST tx_hash to server when deposit tx is signed ---
  useEffect(() => {
    if (!depositHash || submittedHashRef.current === depositHash) return
    submittedHashRef.current = depositHash

    setIsSubmitting(true)

    const MAX_RETRIES = 20
    const RETRY_DELAY = 3000

    const submitDeposit = async (): Promise<VerifyDepositResponse> => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const res = await apiClient<VerifyDepositResponse>("/account/deposit", {
          method: "POST",
          body: { tx_hash: depositHash },
          auth: true,
        })
        // Server returns status "not_mined" when receipt is not yet available
        if (res.status === "not_mined") {
          await new Promise((r) => setTimeout(r, RETRY_DELAY))
          continue
        }
        return res
      }
      throw new Error("Transaction not mined after multiple attempts")
    }

    // Analytics fires HERE (tx signed), not after the verify loop resolves.
    // On L1 the mined+verify wait is 15–60s; a refresh in that window kills
    // the `.then()` closure and the event would be lost even though the
    // deposit itself completes fine in the background (persisted pending
    // store + server). Firing at signature time shrinks the loss window to
    // ~0; the cost is one phantom event in the rare case the tx reverts.
    trackDeposit({
      amount,
      elDollarAmount: receiveElDollar,
      token: walletSymbol,
    })

    submitDeposit()
      .then(async () => {
        // Deposit is mined + server-acked. Move the in-modal stepper to the
        // crediting step (we keep the modal open to show N/15 progress) and
        // refresh the history list. The balance itself is refreshed by the
        // pending-deposit monitor once the confirmations land — here and in the
        // background if the user closes the modal first.
        setDepositVerified(true)
        setActiveTab("deposits")
        await queryClient.refetchQueries({ queryKey: ["deposit-history"] })
        refetchWalletBalance()
      })
      .catch((error) => {
        onOpenChange(false)
        if (error instanceof ApiError) {
          tradingToast.depositFailed(
            "Deposit verification failed. Please try again later."
          )
        } else {
          tradingToast.depositFailed(error.message)
        }
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }, [
    depositHash,
    onOpenChange,
    setActiveTab,
    queryClient,
    refetchWalletBalance,
    amount,
    receiveElDollar,
    walletSymbol,
  ])

  // Register the deposit for the background 15-confirmation balance refresh as
  // soon as it's mined, so the balance still updates if the user closes the
  // modal before crediting finishes. The store is persisted → survives reload.
  useEffect(() => {
    if (!depositHash || !depositReceipt) return
    if (registeredRef.current === depositHash) return
    registeredRef.current = depositHash
    addPendingDeposit({
      txHash: depositHash,
      amount,
      depositBlock: Number(depositReceipt.blockNumber),
      timestamp: Date.now(),
      // Lets the background monitor apply this chain's confirmation policy
      // (Giwa 30 vs default 15) instead of a global constant.
      chainId: targetChainId,
    })
  }, [depositHash, depositReceipt, amount, addPendingDeposit, targetChainId])

  // --- Handle wallet rejection errors via toast ---
  useEffect(() => {
    if (!approveError && !depositError) return
    onOpenChange(false)

    const error = approveError ?? depositError!
    const isUserRejected =
      error.message.includes("User denied") ||
      error.message.includes("User rejected")

    if (approveError) {
      tradingToast.depositFailed(
        isUserRejected
          ? "Approval was declined"
          : "Approval failed. Please try again."
      )
    } else {
      tradingToast.depositFailed(
        isUserRejected
          ? "Deposit transaction was declined"
          : "Deposit failed. Please try again."
      )
    }
  }, [approveError, depositError, onOpenChange])

  // --- Reset state when modal closes ---
  useEffect(() => {
    if (!open) {
      setAmount("")
      resetApprove()
      resetDeposit()
      submittedHashRef.current = null
      setDepositVerified(false)
      registeredRef.current = null
    }
  }, [open, resetApprove, resetDeposit, setAmount])

  // --- Button ---
  const buttonText = useMemo(() => {
    if (isInsufficientBalance) return "Insufficient Balance"
    if (isBelowMinimum)
      return `Minimum deposit amount is ${minDepositDisplay} ${walletSymbol}`
    if (isWrongChain) return `Switch network & deposit`
    return "Deposit"
  }, [
    isInsufficientBalance,
    isBelowMinimum,
    minDepositDisplay,
    walletSymbol,
    isWrongChain,
  ])

  const isButtonDisabled = !isValidAmount || isInsufficientBalance || isBusy

  // --- Derived step states for the in-modal progress view ---
  // The flow is active from the first wallet prompt until the user closes the
  // modal; while active we show the stepper instead of the form.
  const flowActive =
    isApprovePending ||
    isApproveConfirming ||
    !!approveHash ||
    isDepositPending ||
    isDepositConfirming ||
    isSubmitting ||
    !!depositHash
  // Approve step only exists when the token actually needed approval (an
  // approve tx was kicked off); an already-approved token jumps to Deposit.
  const showApprove =
    isApprovePending || isApproveConfirming || isApproveSuccess || !!approveHash
  const approveStatus: StepStatus = isApproveSuccess
    ? "done"
    : isApprovePending || isApproveConfirming
      ? "active"
      : "pending"
  const depositStatus: StepStatus = depositVerified
    ? "done"
    : isDepositPending || isDepositConfirming || isSubmitting || !!depositHash
      ? "active"
      : "pending"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] gap-4 rounded-2xl border-[#2e2e2e] bg-[#1a1a1a]">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {flowActive ? "Deposit in progress" : "Deposit"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {flowActive
              ? `Tracking your ${tokenSymbol} deposit through approval, submission, and crediting`
              : `Deposit ${tokenSymbol} to your perp account`}
          </DialogDescription>
        </DialogHeader>

        {/* Multi-step progress (approve → deposit → crediting) */}
        {flowActive ? (
          <DepositStepper
            showApprove={showApprove}
            approveStatus={approveStatus}
            depositStatus={depositStatus}
            depositBlock={depositBlock}
            blockTimeMs={creditBlockTimeMs}
            requiredConfirmations={getDepositConfirmations(targetChainId)}
            currentBlock={
              currentBlock != null ? Number(currentBlock) : undefined
            }
            onClose={() => onOpenChange(false)}
          />
        ) : (
          // Spacing mirrors the Figma rhythm (node 2276-9136): the input block
          // is packed tight (4–8px), the CTA gets a big 24px breather. A
          // uniform gap made the modal read taller than the design.
          <div className="flex flex-col">
            {/* Max + wallet balance (right-aligned, above the input) */}
            <div className="mb-1 flex items-center justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={handleMax}
                className="cursor-pointer font-medium text-[#0086fc] hover:text-[#0086fc]/80"
              >
                Max
              </button>
              <span className="text-muted-foreground">
                Balance{" "}
                <span className="font-mono text-foreground">
                  {formattedBalance} {walletSymbol}
                </span>
              </span>
            </div>

            {/* Amount input + token chip */}
            <div className="flex h-11 items-center gap-2 rounded-sm border border-[#222] pl-3 pr-1.5">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                placeholder={placeholder}
                className="min-w-0 flex-1 bg-transparent font-mono text-lg outline-none placeholder:text-muted-foreground"
              />
              <TokenPickerPopover
                items={pickerItems}
                selectedAssetId={selectedAssetId}
                triggerLabel={walletSymbol}
                disabled={isBusy}
                onSelect={setSelectedAssetId}
              />
            </div>

            {/* Minimum deposit */}
            <p className="mt-2 text-[10px] text-muted-foreground">
              Minimum deposit: {minDepositDisplay} {walletSymbol}
            </p>

            {/* You receive. 1:1 collaterals (USDT/USDC) skip the rate row. */}
            <ReceivePanel
              amountDisplay={receiveDisplay}
              symbol={tokenSymbol}
              usdDisplay={receiveUsdDisplay}
              rateText={
                tokensPerDollar !== 1
                  ? `${tokensPerDollar} ${walletSymbol} = 1 ${tokenSymbol}`
                  : null
              }
            />

            {/* Deposit CTA */}
            <Button
              className="mt-6 h-11 w-full rounded-md bg-[#0086fc] text-white hover:bg-[#0086fc]/90"
              disabled={isButtonDisabled}
              onClick={handleDeposit}
            >
              {isApprovePending || isDepositPending || isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                buttonText
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
