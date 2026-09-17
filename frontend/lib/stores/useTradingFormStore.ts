import { create } from "zustand"
import { PerpOrderType } from "@/types"

// Truncate to N decimal places (no rounding).
//
// We deliberately avoid the classic `Math.floor(value * 10^N) / 10^N`
// shortcut: it bites on values like 0.1235, whose IEEE 754 representation
// is 0.12349999…, so `0.1235 * 10000 = 1234.9999…` floors to 1234 and the
// user's typed `0.1235` becomes `0.1234`. Off by a full decimal place at
// the size precision the order form uses — silent dust that drifts the
// slider out of sync with the amount.
//
// Instead, ask `toFixed` to materialise one extra digit (it uses the
// engine's IEEE 754 rounding-to-nearest, which lands on the user-intended
// digits), then string-truncate at the requested precision.
function truncateAmount(value: number, decimals: number = 4): string {
  if (!Number.isFinite(value)) return (0).toFixed(decimals)
  if (decimals < 0) return Math.trunc(value).toString()
  const sign = value < 0 ? "-" : ""
  const str = Math.abs(value).toFixed(decimals + 1)
  const [intPart, decPart = ""] = str.split(".")
  if (decimals === 0) return `${sign}${intPart}`
  const truncatedDec = decPart.slice(0, decimals).padEnd(decimals, "0")
  return `${sign}${intPart}.${truncatedDec}`
}

// Cap slippage at 10% — a market order should never be allowed to fill more
// than 10% away from mark. Enforced HERE in the store (not just per-editor UI)
// so every writer — the order form's editor, the Close-Position modal's
// editor, or any future one — is bound by the same policy.
export const MAX_SLIPPAGE = 10

interface TradingFormState {
  side: "Long" | "Short"
  orderType: PerpOrderType
  orderPrice: string
  amount: string
  sliderValue: number
  lastChangeType: "amount" | "slider" | null
  leverage: number
  marginMode: "Isolated" | "Cross"
  reduceOnly: boolean
  maxSlippage: number // Max slippage % for market orders
  isLeverageModalOpen: boolean
  isMarginModeModalOpen: boolean

  // Simple setters
  setSide: (side: "Long" | "Short") => void
  setOrderType: (type: PerpOrderType) => void
  setOrderPrice: (price: string) => void
  setLeverage: (leverage: number) => void
  setMarginMode: (mode: "Isolated" | "Cross") => void
  setReduceOnly: (reduceOnly: boolean) => void
  setMaxSlippage: (slippage: number) => void
  setIsLeverageModalOpen: (open: boolean) => void
  setIsMarginModeModalOpen: (open: boolean) => void

  // Complex actions that sync amount <-> slider
  handleAmountChange: (
    value: string,
    priceNum: number,
    availableQuoteRaw: number,
    reduceableAmount: number,
    oppositePositionSize?: number
  ) => void
  handleSliderChange: (
    value: number,
    priceNum: number,
    availableQuoteRaw: number,
    reduceableAmount: number,
    oppositePositionSize?: number,
    baseDecimals?: number
  ) => void
  syncOnPriceChange: (availableQuoteRaw: number, baseDecimals?: number) => void
  resetForMarketChange: (newDefaultPrice: string) => void
}

export const useTradingFormStore = create<TradingFormState>((set, get) => ({
  side: "Long",
  orderType: "Limit",
  orderPrice: "",
  amount: "",
  sliderValue: 0,
  lastChangeType: null,
  leverage: 10,
  marginMode: "Isolated",
  reduceOnly: false,
  maxSlippage: 0.5,
  isLeverageModalOpen: false,
  isMarginModeModalOpen: false,

  setSide: (side) => set({ side }),
  setOrderType: (type) => set({ orderType: type }),
  setOrderPrice: (price) => set({ orderPrice: price }),
  setLeverage: (leverage) => set({ leverage }),
  setMarginMode: (mode) => set({ marginMode: mode }),
  setReduceOnly: (reduceOnly) => set({ reduceOnly }),
  setMaxSlippage: (slippage) =>
    set({
      maxSlippage: Number.isFinite(slippage)
        ? Math.min(Math.max(slippage, 0.01), MAX_SLIPPAGE)
        : 0.5,
    }),
  setIsLeverageModalOpen: (open) => set({ isLeverageModalOpen: open }),
  setIsMarginModeModalOpen: (open) => set({ isMarginModeModalOpen: open }),

  handleAmountChange: (
    value,
    priceNum,
    availableQuoteRaw,
    reduceableAmount,
    _oppositePositionSize = 0
  ) => {
    const { reduceOnly, leverage } = get()
    const amountNum = Number.parseFloat(value)

    let newSliderValue = 0
    if (priceNum > 0 && value && amountNum > 0) {
      const newTotal = priceNum * amountNum
      // Capacity = balance × leverage. We do NOT credit closing an opposite
      // position: the backend locks margin for the order's FULL size at R1
      // (the closed portion's margin is released only post-match at R2), so
      // crediting the close here oversizes the order and it's rejected as
      // insufficient margin. To close without locking margin, use Reduce Only.
      const maxNotional = reduceOnly
        ? reduceableAmount * priceNum
        : availableQuoteRaw * leverage
      const percentage = Math.min(
        100,
        maxNotional > 0 ? (newTotal / maxNotional) * 100 : 0
      )
      newSliderValue = Math.round(percentage)
    }

    set({
      amount: value,
      sliderValue: newSliderValue,
      lastChangeType: "amount",
    })
  },

  handleSliderChange: (
    value,
    priceNum,
    availableQuoteRaw,
    reduceableAmount,
    _oppositePositionSize = 0,
    baseDecimals = 4
  ) => {
    const { reduceOnly, leverage } = get()

    let newAmount = "0"
    if (priceNum > 0) {
      if (reduceOnly && value === 100) {
        // Use exact position size to avoid dust remainders
        newAmount = reduceableAmount > 0 ? String(reduceableAmount) : "0"
      } else {
        // No opposite-position credit: the backend locks the order's full
        // size at R1 (see handleAmountChange). Capacity = balance × leverage.
        const targetTotal = reduceOnly
          ? reduceableAmount * priceNum * (value / 100)
          : availableQuoteRaw * leverage * (value / 100)
        const computed = targetTotal / priceNum
        newAmount = computed > 0 ? truncateAmount(computed, baseDecimals) : "0"
      }
    }

    set({
      sliderValue: value,
      amount: newAmount,
      lastChangeType: "slider",
    })
  },

  syncOnPriceChange: (availableQuoteRaw, baseDecimals = 4) => {
    const { lastChangeType, orderPrice, amount, sliderValue, leverage } = get()

    if (lastChangeType === "amount") {
      const notional =
        Number(orderPrice || "0") * Number.parseFloat(amount || "0")
      const maxNotional = availableQuoteRaw * leverage
      set({
        sliderValue: Math.round(
          Math.min(100, maxNotional > 0 ? (notional / maxNotional) * 100 : 0)
        ),
      })
    } else if (lastChangeType === "slider") {
      const priceNum = Number(orderPrice)
      set({
        amount:
          priceNum === 0
            ? ""
            : truncateAmount(
                (availableQuoteRaw * leverage * (sliderValue / 100)) / priceNum,
                baseDecimals
              ),
      })
    }
  },

  resetForMarketChange: (newDefaultPrice) => {
    set({
      orderPrice: newDefaultPrice,
      amount: "",
      sliderValue: 0,
      lastChangeType: null,
    })
  },
}))
