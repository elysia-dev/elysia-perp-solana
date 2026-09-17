"use client"

/**
 * QA-only: Dev authentication & deposit button.
 * Remove this entire `components/dev/` folder after QA is complete.
 */

import { useState, useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { apiClient } from "@/lib/api/client"
import { formatAddress } from "@/lib/utils"
import { ASSET_IDS } from "@/lib/constants/assets"

const API_URL = "/api"

export function DevAuthButton() {
  const { setAuthenticated } = useAuthContext()
  const queryClient = useQueryClient()

  const [devAddress, setDevAddress] = useState("")
  const [isDevAuthed, setIsDevAuthed] = useState(false)
  const [authedAddress, setAuthedAddress] = useState("")
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [depositAmount, setDepositAmount] = useState("")
  const [isDepositing, setIsDepositing] = useState(false)

  const isValidAddress =
    devAddress.trim().startsWith("0x") && devAddress.trim().length === 42

  const handleDevLogin = useCallback(async () => {
    const addr = devAddress.trim()
    if (!addr) return
    setIsLoggingIn(true)
    try {
      const res = await fetch(`${API_URL}/dev/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address: addr }),
      })
      if (!res.ok) throw new Error("Dev token request failed")
      setIsDevAuthed(true)
      setAuthedAddress(addr)
      setAuthenticated(true)
    } catch (err) {
      console.error("[DevAuth] Login failed:", err)
    } finally {
      setIsLoggingIn(false)
    }
  }, [devAddress, setAuthenticated])

  const handleDevLogout = useCallback(async () => {
    // Clear server cookies via logout API
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {})
    setIsDevAuthed(false)
    setAuthedAddress("")
    setDevAddress("")
    setDepositAmount("")
    setAuthenticated(false)
    queryClient.clear()
  }, [setAuthenticated, queryClient])

  const handleDevDeposit = useCallback(async () => {
    const amount = depositAmount.trim()
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return
    setIsDepositing(true)
    try {
      await apiClient("/dev/account/deposit", {
        method: "POST",
        auth: true,
        body: {
          asset_id: ASSET_IDS.EL,
          amount,
          route_type: "perp",
        },
      })
      queryClient.invalidateQueries({ queryKey: ["account"] })
      setDepositAmount("")
    } catch (err) {
      console.error("[DevAuth] Deposit failed:", err)
    } finally {
      setIsDepositing(false)
    }
  }, [depositAmount, queryClient])

  return (
    <div className="flex items-center gap-1">
      {isDevAuthed ? (
        <>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Amount"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="h-8 w-24 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isDepositing || !depositAmount.trim()}
            onClick={handleDevDeposit}
          >
            {isDepositing ? "..." : "Dev Deposit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleDevLogout}
          >
            {formatAddress(authedAddress)} ✕
          </Button>
        </>
      ) : (
        <>
          <Input
            type="text"
            placeholder="0x..."
            value={devAddress}
            onChange={(e) => setDevAddress(e.target.value)}
            className="h-8 w-36 font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isLoggingIn || !isValidAddress}
            onClick={handleDevLogin}
          >
            {isLoggingIn ? "..." : "Dev Login"}
          </Button>
        </>
      )}
    </div>
  )
}
