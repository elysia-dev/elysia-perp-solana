"use client"

import { useState } from "react"
import Image from "next/image"
import { ChevronDown } from "lucide-react"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { getAssetIcon } from "@/lib/constants/assets"

export interface TokenPickerItem {
  assetId: number
  /** Symbol label shown next to the icon (e.g. "EL", "EL$", "USDC"). */
  label: string
  /** Right-aligned secondary text: chain name, available balance, … */
  meta?: string
  /** Extra classes for the meta text (e.g. "font-mono" for numbers). */
  metaClassName?: string
}

/**
 * Token chip + dropdown shared by the deposit and withdraw modals (one
 * implementation of the picker instead of a copy per modal). The trigger
 * renders the selected token as a chip; opening it lists `items`, and
 * choosing one calls `onSelect` and closes.
 */
export function TokenPickerPopover({
  items,
  selectedAssetId,
  triggerLabel,
  disabled,
  onSelect,
}: {
  items: TokenPickerItem[]
  selectedAssetId: number
  /** Chip label for the currently selected token. */
  triggerLabel: string
  /** Disable while a transaction is in flight so the token can't change mid-flow. */
  disabled?: boolean
  onSelect: (assetId: number) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-[#1e1e1e] pl-2 pr-1.5 hover:border-[#4a4a4a] disabled:cursor-default disabled:opacity-60"
        >
          <Image
            src={getAssetIcon(selectedAssetId)}
            alt={triggerLabel}
            width={18}
            height={18}
            className="rounded-full"
          />
          <span className="text-[13px] font-medium">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-60 rounded-md border-[#2e2e2e] bg-[#1e1e1e] p-1"
      >
        {items.map((item) => (
          <button
            key={item.assetId}
            type="button"
            onClick={() => {
              onSelect(item.assetId)
              setOpen(false)
            }}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-[#2a2a2a] ${
              item.assetId === selectedAssetId ? "bg-[#252525]" : ""
            }`}
          >
            <Image
              src={getAssetIcon(item.assetId)}
              alt={item.label}
              width={20}
              height={20}
              className="rounded-full"
            />
            <span className="text-[13px] font-medium">{item.label}</span>
            {item.meta != null ? (
              <span
                className={`ml-auto text-[11px] text-muted-foreground ${
                  item.metaClassName ?? ""
                }`}
              >
                {item.meta}
              </span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
