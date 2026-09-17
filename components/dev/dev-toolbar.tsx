"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { DevAuthButton } from "@/components/dev/dev-auth-button"
import { useDevModeStore } from "@/lib/stores/useDevModeStore"
import { SHOW_TEST_UI } from "@/lib/constants/network"
import { Bug } from "lucide-react"

export function DevToolbar() {
  const devEnabled = useDevModeStore((s) => s.enabled)
  const [open, setOpen] = useState(false)

  const showDevTools = SHOW_TEST_UI && devEnabled

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
