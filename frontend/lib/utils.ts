import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { getAssetMeta } from "@/lib/constants/assets"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// TODO: after implementation of market name on backend api, remove this function
export function getAssetName(assetId: number) {
  return getAssetMeta(assetId).symbol
}

// Format number with commas
export function formatNumber(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value
  if (isNaN(num)) return "-"
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  })
}

// Format address to display name (e.g., 0x1234...5678)
export function formatAddress(address: string): string {
  if (!address) return ""
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Convert decimal 18 string to bigint
export function decimal18ToBigInt(value: string | number): bigint {
  const str = typeof value === "number" ? value.toString() : value
  if (!str || str === "0") return BigInt(0)

  const parts = str.split(".")
  const integerPart = parts[0] || "0"
  let decimalPart = parts[1] || ""

  // Pad or truncate decimal part to 18 digits
  if (decimalPart.length < 18) {
    decimalPart = decimalPart.padEnd(18, "0")
  } else {
    decimalPart = decimalPart.slice(0, 18)
  }

  return BigInt(integerPart + decimalPart)
}

// Convert bigint back to decimal 18 string
export function bigIntToDecimal18(value: bigint): string {
  const str = value.toString()
  if (str === "0") return "0"

  // Pad with zeros to ensure at least 18 digits
  const padded = str.padStart(19, "0") // At least 1 integer digit + 18 decimal digits
  const integerPart = padded.slice(0, -18) || "0"
  const decimalPart = padded.slice(-18)

  // Remove trailing zeros from decimal part
  const trimmedDecimal = decimalPart.replace(/0+$/, "")

  if (trimmedDecimal === "") {
    return integerPart
  }

  return `${integerPart}.${trimmedDecimal}`
}

// Add two decimal 18 strings using bigint
export function addDecimal18(a: string | number, b: string | number): string {
  const aBigInt = decimal18ToBigInt(a)
  const bBigInt = decimal18ToBigInt(b)
  const sum = aBigInt + bBigInt
  return bigIntToDecimal18(sum)
}

// Format date: supports ISO string, Unix seconds/ms (string or number)
// e.g. "2026-01-08 11:06:58.982502 +00:00" -> "1/8/2026 20:17:18"
//      1711900000 or "1711900000"            -> "3/31/2024 ..."
export function formatDate(value: string | number): string {
  if (value === "" || value == null) return "-"

  let date: Date
  // Convert numeric timestamps to ms:
  //   seconds      < 1e12   (10 digits)
  //   milliseconds < 1e15   (13 digits)
  //   microseconds < 1e18   (16 digits)
  //   nanoseconds  >= 1e18  (19 digits)
  const toMs = (n: number): number => {
    if (n < 1e12) return n * 1000 // seconds → ms
    if (n < 1e15) return n // already ms
    if (n < 1e18) return n / 1000 // microseconds → ms
    return n / 1e6 // nanoseconds → ms
  }

  if (typeof value === "number") {
    date = new Date(toMs(value))
  } else if (/^\d+(\.\d+)?$/.test(value)) {
    date = new Date(toMs(parseFloat(value)))
  } else {
    date = new Date(value)
  }

  if (isNaN(date.getTime())) return "-"

  const month = date.getMonth() + 1
  const day = date.getDate()
  const year = date.getFullYear()
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`
}
