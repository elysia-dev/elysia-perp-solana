"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface AuthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onTryAgain: () => void
}

export function AuthModal({ open, onOpenChange, onTryAgain }: AuthModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Authenticate</DialogTitle>
          <DialogDescription className="sr-only">
            Wallet signature was cancelled
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="text-sm">
            <p>Signature cancelled.</p>
            <p className="text-muted-foreground">
              Please connect your wallet and sign to continue.
            </p>
          </div>

          <Button
            className="w-full"
            onClick={() => {
              onOpenChange(false)
              onTryAgain()
            }}
          >
            Try Again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
