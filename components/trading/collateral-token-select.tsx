"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EcosystemLogo } from "@/components/trading/ecosystem-logo"
import { ECOSYSTEMS, DEFAULT_ECOSYSTEM_ID } from "@/lib/config/markets"

interface Props {
  value: string
  onValueChange: (id: string) => void
  /** Suffix appended to the symbol (e.g. "$" for perp-side accounting). */
  suffix?: string
  className?: string
}

/**
 * Token selector listing all ecosystem collateral tokens. Currently only the
 * default ecosystem (Elysia / EL) is selectable — every other token is shown
 * with a "Soon" badge and disabled until the corresponding rail goes live.
 */
export function CollateralTokenSelect({
  value,
  onValueChange,
  suffix = "",
  className,
}: Props) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ECOSYSTEMS.map((eco) => {
          const isEnabled = eco.id === DEFAULT_ECOSYSTEM_ID
          return (
            <SelectItem key={eco.id} value={eco.id} disabled={!isEnabled}>
              <span className="flex items-center gap-2">
                <EcosystemLogo ecosystem={eco} size={16} />
                <span className="font-medium">
                  {eco.collateralToken}
                  {suffix}
                </span>
                {!isEnabled && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Soon
                  </span>
                )}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
