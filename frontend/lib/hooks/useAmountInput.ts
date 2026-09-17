"use client"

import { useState, useCallback } from "react"

/**
 * Amount-input state + change handler shared by the deposit / withdraw / mint
 * modals. One implementation of the input rules instead of three copies:
 *   - digits and at most one dot (`123`, `0.5`, `.5` while typing)
 *   - no leading zeros ("01" rejected; "0" and "0.xxx" allowed)
 *   - at most `maxDecimals` fractional digits
 * Rejected keystrokes are ignored (state unchanged) rather than clamped, so
 * the caret never jumps.
 */
export function useAmountInput(maxDecimals: number, initialValue = "") {
  const [amount, setAmount] = useState(initialValue)

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value

      if (value === "") {
        setAmount("")
        return
      }

      if (!/^\d*\.?\d*$/.test(value)) return

      // Prevent leading zeros (allow "0" and "0.xxx" only)
      if (value.length > 1 && value[0] === "0" && value[1] !== ".") return

      const dotIndex = value.indexOf(".")
      if (dotIndex !== -1) {
        const decimalPart = value.slice(dotIndex + 1)
        if (decimalPart.length > maxDecimals) return
      }

      setAmount(value)
    },
    [maxDecimals]
  )

  return { amount, setAmount, handleAmountChange }
}
