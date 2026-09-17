/** Format a number as a price with 1 fractional digit, locale-grouped. */
export const formatPrice = (v: number) =>
  v.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })

/** Format a USD amount with M/K suffix above the respective thresholds. */
export const formatUsdCompact = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`
  return `$${v.toFixed(2)}`
}

/** Format a base-asset volume with K suffix above 1,000. */
export const formatBaseVolumeCompact = (v: number) => {
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`
  return v.toFixed(2)
}

/** Parse a string number defensively (empty/null → 0). */
export const numOrZero = (v: string | undefined | null) =>
  v != null && v !== "" ? parseFloat(v) : 0
