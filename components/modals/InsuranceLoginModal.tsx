"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useInsuranceLogin } from "@/lib/hooks/useInsuranceLogin"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { tradingToast } from "@/lib/utils/toast"

interface InsuranceLoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InsuranceLoginModal({
  open,
  onOpenChange,
}: InsuranceLoginModalProps) {
  const [password, setPassword] = useState("")
  const insuranceLogin = useInsuranceLogin()
  const { setAuthenticated } = useAuthContext()

  useEffect(() => {
    if (open) setPassword("")
  }, [open])

  const handleSubmit = () => {
    if (!password.trim()) return
    insuranceLogin.mutate(password, {
      onSuccess: () => {
        setAuthenticated(true)
        onOpenChange(false)
        tradingToast.success?.(
          "Logged in",
          "Insurance Fund admin session started"
        )
      },
      onError: (err) => {
        tradingToast.error?.(
          "Login failed",
          err instanceof Error ? err.message : "Invalid credentials"
        )
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>Insurance Fund Login</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Enter the admin password to log in as the Insurance Fund.
        </p>

        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          autoFocus
        />

        <Button
          onClick={handleSubmit}
          disabled={!password.trim() || insuranceLogin.isPending}
          className="w-full"
        >
          {insuranceLogin.isPending ? "Signing in..." : "Login"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
