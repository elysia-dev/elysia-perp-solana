"use client"

import { useMemo } from "react"
import { useReadContract } from "wagmi"
import { formatUnits, parseUnits } from "viem"
import { CONTRACTS } from "@/lib/contracts/addresses"
import { PRIMARY_CHAIN_ID } from "@/lib/constants/network"
import { MockTokenAbi } from "@/lib/contracts/abi/MockTokenAbi"
import { ASSET_IDS } from "@/lib/constants/assets"
import { useBalance } from "./useBalance"
import { useMintToken } from "./useMintToken"
import { usePositions } from "./usePositions"

export const MINT_CAP = 10_000
export const DEFAULT_MINT_AMOUNT = "1000000"

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as `0x${string}`

export type MintGate = {
  blocked: boolean
  reason: string
  heldDisplay: string
  capDisplay: string
  balanceDisplay: string
  availableDisplay: string
  lockedDisplay: string
  marginDisplay: string
}

function safeParseUnits(value: string, decimals: number): bigint | null {
  try {
    return parseUnits(value, decimals)
  } catch {
    return null
  }
}

function formatHeld(raw: bigint, decimals: number): string {
  const n = parseFloat(formatUnits(raw, decimals))
  if (!Number.isFinite(n)) return "–"
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function useMintCap(params: {
  address: `0x${string}` | undefined
  amount: string
}): MintGate {
  const { address, amount } = params

  const { decimals } = useMintToken()
  const { data: balanceData, isError: balError } = useBalance()
  const { data: positionsData, isError: posError } = usePositions()
  const { data: onchainBalance, isError: chainError } = useReadContract({
    address: CONTRACTS[PRIMARY_CHAIN_ID].collateralToken,
    abi: MockTokenAbi,
    functionName: "balanceOf",
    args: [address ?? ZERO_ADDRESS],
    query: { enabled: !!address },
  })

  return useMemo<MintGate>(() => {
    const capDisplay = MINT_CAP.toLocaleString()
    const pending = (reason: string): MintGate => ({
      blocked: true,
      reason,
      heldDisplay: "–",
      capDisplay,
      balanceDisplay: "–",
      availableDisplay: "–",
      lockedDisplay: "–",
      marginDisplay: "–",
    })

    if (decimals == null) return pending("loading token…")
    if (balError || posError || chainError)
      return pending("balance unavailable")
    if (!balanceData || !positionsData || onchainBalance == null || !address) {
      return pending("loading…")
    }

    const capRaw = parseUnits(String(MINT_CAP), decimals)
    // The mint cap is enforced against the EL collateral token (the on-chain
    // MockToken). With multi-token balances we must target EL explicitly rather
    // than balances[0], whose order is not guaranteed.
    const balance = balanceData.balances.find(
      (b) => b.asset_id === ASSET_IDS.EL
    )
    const availableRaw = safeParseUnits(balance?.available ?? "0", decimals)
    const lockedRaw = safeParseUnits(balance?.locked ?? "0", decimals)
    if (availableRaw == null || lockedRaw == null) {
      return pending("bad balance format")
    }

    let marginRaw = 0n
    for (const p of positionsData.positions) {
      const m = safeParseUnits(p.margin ?? "0", decimals)
      if (m == null) return pending("bad margin format")
      marginRaw += m
    }

    const balanceRaw = onchainBalance as bigint
    const heldRaw = balanceRaw + availableRaw + lockedRaw + marginRaw

    const breakdown = {
      heldDisplay: formatHeld(heldRaw, decimals),
      capDisplay,
      balanceDisplay: formatHeld(balanceRaw, decimals),
      availableDisplay: formatHeld(availableRaw, decimals),
      lockedDisplay: formatHeld(lockedRaw, decimals),
      marginDisplay: formatHeld(marginRaw, decimals),
    }

    if (heldRaw >= capRaw) {
      return { blocked: true, reason: "cap reached", ...breakdown }
    }

    const inputRaw = safeParseUnits(amount, decimals)
    if (inputRaw == null) {
      return { blocked: true, reason: "invalid amount", ...breakdown }
    }

    if (heldRaw + inputRaw > capRaw) {
      return { blocked: true, reason: "exceeds cap", ...breakdown }
    }

    return { blocked: false, reason: "", ...breakdown }
  }, [
    decimals,
    balanceData,
    positionsData,
    onchainBalance,
    address,
    amount,
    balError,
    posError,
    chainError,
  ])
}
