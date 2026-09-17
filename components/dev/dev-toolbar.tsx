"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DevAuthButton } from "@/components/dev/dev-auth-button"
import { useMintToken } from "@/lib/hooks/useMintToken"
import {
  DEFAULT_MINT_AMOUNT,
  MINT_CAP,
  useMintCap,
} from "@/lib/hooks/useMintCap"
import { useDevModeStore } from "@/lib/stores/useDevModeStore"
import { SHOW_TEST_UI } from "@/lib/constants/network"
import { useConnection } from "wagmi"
import { Bug } from "lucide-react"

function mintDisabledMessage(reason: string): string {
  if (reason === "exceeds cap" || reason === "cap reached") {
    return `Max token amount limit: ${MINT_CAP.toLocaleString()}`
  }
  return reason || "Mint unavailable"
}

export function DevToolbar() {
  const devEnabled = useDevModeStore((s) => s.enabled)
  const [open, setOpen] = useState(false)
  const {
    mint,
    isPending: isMinting,
    isConfirming: isMintConfirming,
  } = useMintToken()
  const { isConnected, address } = useConnection()
  const [mintAmount, setMintAmount] = useState("")
  const effectiveAmount = mintAmount.trim() || DEFAULT_MINT_AMOUNT
  const mintGate = useMintCap({ address, amount: effectiveAmount })

  const showDevTools = SHOW_TEST_UI && devEnabled
  const showMint = isConnected && !!address

  if (!showDevTools) return null

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        onClick={() => setOpen(!open)}
      >
        <Bug className="h-4 w-4" />
      </Button>

      {open && (
        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-2 duration-200">
          <DevAuthButton />

          {/* Data Check toggle */}
          <DataCheckSwitch />

          {/* Mint controls — only when wallet is connected */}
          {showMint && address && (
            <div className="flex items-center gap-1 border-l border-border pl-3">
              <Input
                type="text"
                placeholder="1,000,000"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                className="h-8 w-28 text-xs"
              />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={
                          isMinting || isMintConfirming || mintGate.blocked
                        }
                        onClick={() => mint(address, effectiveAmount)}
                      >
                        {isMinting
                          ? "Signing..."
                          : isMintConfirming
                            ? "Minting..."
                            : "Mint"}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {mintGate.blocked && (
                    <TooltipContent
                      side="bottom"
                      className="text-[11px] leading-snug"
                    >
                      {mintDisabledMessage(mintGate.reason)}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DataCheckSwitch() {
  const dataCheckEnabled = useDevModeStore((s) => s.dataCheckEnabled)
  const toggleDataCheck = useDevModeStore((s) => s.toggleDataCheck)

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Data</span>
      <Switch checked={dataCheckEnabled} onCheckedChange={toggleDataCheck} />
    </div>
  )
}
