"use client"

import Image from "next/image"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getAssetIcon } from "@/lib/constants/assets"
import { getAssetName } from "@/lib/utils"

interface Props {
  /** asset_ids to offer, e.g. the tokens present on the account. */
  assetIds: number[]
  /** Currently selected asset_id. */
  value: number
  onValueChange: (assetId: number) => void
  className?: string
}

/**
 * Token selector keyed by asset_id. Used for multi-token flows (ELP-133) such
 * as withdraw, where the user chooses which deposited token to act on.
 */
export function TokenSelect({
  assetIds,
  value,
  onValueChange,
  className,
}: Props) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onValueChange(Number(v))}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {assetIds.map((id) => (
          <SelectItem key={id} value={String(id)}>
            <span className="flex items-center gap-2">
              <Image
                src={getAssetIcon(id)}
                alt={getAssetName(id)}
                width={16}
                height={16}
              />
              <span className="font-medium">{getAssetName(id)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
