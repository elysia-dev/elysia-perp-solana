"use client"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { PerpTradingForm } from "@/components/perp-trading-form"

interface TradingFormDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TradingFormDrawer({
  open,
  onOpenChange,
}: TradingFormDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90vh] flex-col rounded-t-xl border-t border-border bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Place Order
          </DialogPrimitive.Title>

          {/* Header bar with drag handle + close button */}
          <div className="relative flex shrink-0 items-center justify-center px-4 pb-2 pt-3">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-3 pt-0 [&>div]:!w-full">
            <PerpTradingForm />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
