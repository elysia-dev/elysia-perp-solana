"use client"

import { useConnection } from "wagmi"
import { useBalance } from "@/lib/hooks/useBalance"
import { useSelectedPair } from "@/lib/stores"
import type { Balance } from "@/types"

/**
 * Should trade CTAs be replaced with "Deposit to Trade" (Figma 3118-2049)?
 *
 * True when a CONNECTED wallet has zero available balance in the current
 * market's quote collateral — every order attempt would dead-end in
 * "Not Enough Margin", so the real next step is a deposit. Gated on the
 * balance response having ARRIVED (`balanceData != null`): the raw 0 is
 * also the loading default, and without the gate the CTA flashes during
 * the initial fetch. Shared by the desktop trading form's submit button
 * and the mobile sticky Buy/Sell bar so the two can never disagree.
 */
export function useShowDepositCta(): boolean {
  const { address } = useConnection()
  const { data: balanceData } = useBalance()
  const pair = useSelectedPair()

  if (!address || balanceData == null) return false
  const quoteBalance = (balanceData.balances ?? []).find(
    (b: Balance) => b.asset_id === pair.quote_currency
  )
  const available = quoteBalance ? parseFloat(quoteBalance.available) : 0
  return available <= 0
}

/** Figma 3118-2049 gradient — one definition so form + mobile bar match. */
export const DEPOSIT_CTA_GRADIENT =
  "linear-gradient(90deg, #4eacff 0%, #0086fc 22%, #0086fc 80%, #4eacff 100%)"
