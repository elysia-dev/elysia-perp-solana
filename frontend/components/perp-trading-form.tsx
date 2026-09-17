"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { ChevronDown, ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { LeverageModal } from "@/components/trading/leverage-modal"
import { MarginModeModal } from "@/components/trading/margin-mode-modal"
import { useBalance } from "@/lib/hooks/useBalance"
import { Balance, PerpOrderType, sideToIsAsk } from "@/types"
import { useAppKitAccount } from "@reown/appkit/react"
import { tradingToast } from "@/lib/utils/toast"
import { useCreatePerpOrder } from "@/lib/hooks/useCreatePerpOrder"
import { useMarketMode } from "@/lib/hooks/useMarketMode"
import {
  useShowDepositCta,
  DEPOSIT_CTA_GRADIENT,
} from "@/lib/hooks/useShowDepositCta"
import { toOrderErrorReason } from "@/lib/utils/orderError"
import { useHistoryTabStore } from "@/lib/stores"
import { useDepositWithdrawModal } from "@/lib/stores/useDepositWithdrawModal"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { useOrderBookDetails } from "@/lib/hooks/useOrderBookDetails"
import { useAccount } from "@/lib/hooks/useAccount"
import { useOrderbook } from "@/lib/hooks/useOrderbook"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { imfToLeverage } from "@/types"
import { FEE_TICK } from "@/lib/constants/scaling"
import { computeLiquidationPrice, mmfFractionOf } from "@/lib/utils/liquidation"
import {
  useSelectedPair,
  useMarketStore,
  useMarkPriceStore,
  selectMarkPrice,
} from "@/lib/stores"
import { useTradingFormStore, MAX_SLIPPAGE } from "@/lib/stores"
import {
  usePositionsList,
  useCurrentMarketPosition,
} from "@/lib/hooks/usePositions"

// 소수점 세 번째 자리에서 내림하여 두 번째 자리까지 표시
function formatBalance(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2)
}

// Parse price string (remove commas) to number
function parsePriceInput(value: string): number {
  return Number.parseFloat(value || "0")
}

// Minimum order notional the backend accepts. Mirrors the Rust constant
// `MIN_NOTIONAL_DOLLARS = 1` in `common/src/scaling.rs`: an order whose value
// (price × size) is below $1 is rejected with a scaling error that surfaces as
// "invalid order arguments". We pre-check it here so the user is told up front
// (button + inline hint) instead of hitting a failed-order toast.
const MIN_ORDER_VALUE_USD = 1

const orderTypeOptions: { label: string; value: PerpOrderType }[] = [
  {
    label: "Limit",
    value: "Limit",
  },
  {
    label: "Market",
    value: "Market",
  },
]

const SLIPPAGE_PRESETS = [0.1, 0.3, 0.5, 1.0]

export function PerpTradingForm() {
  const pair = useSelectedPair()
  const selectedPrice = useMarketStore((s) => s.selectedPrice)
  // ELP-499: FX-session markets (USDKRW) can be reduce_only (session closed)
  // or halted (oracle fault). 24/7 markets are always "active" so all the
  // gating below is inert for them. These gates are UI hints only — the
  // server's order response (MARKET_HALTED / MARKET_REDUCE_ONLY reasons,
  // mapped in toOrderErrorReason) is the final judge.
  const marketMode = useMarketMode(pair.id, pair.name)

  const baseCurrency = pair.base
  // Quote/collateral token follows the active market (multi-token, ELP-133):
  // BTC-PERP quotes in EL$, BTC-PERP-USDT quotes in USDT.
  const quoteCurrency = pair.quote

  // Derive decimal places from market scale_k (e.g. BTC: base=5, quote=1)
  const baseDecimals = useMemo(
    () => Math.round(Math.log10(pair.base_scale_k || 100000)),
    [pair.base_scale_k]
  )
  const quoteDecimals = useMemo(
    () => Math.round(Math.log10(pair.quote_scale_k || 10)),
    [pair.quote_scale_k]
  )

  // Reject input if decimal places exceed allowed limit
  const exceedsDecimals = (value: string, maxDecimals: number): boolean => {
    const parts = value.split(".")
    return parts.length >= 2 && parts[1].length > maxDecimals
  }

  const priceMaxIntDigits = useMemo(() => 10 - quoteDecimals, [quoteDecimals])

  // Extensible size unit options — "base" is always the internal unit
  const sizeUnitOptions = useMemo(
    () => [
      { value: "base", label: baseCurrency },
      { value: "quote", label: quoteCurrency },
    ],
    [baseCurrency, quoteCurrency]
  )

  // Trading form store
  const side = useTradingFormStore((s) => s.side)
  const orderType = useTradingFormStore((s) => s.orderType)
  const orderPrice = useTradingFormStore((s) => s.orderPrice)
  const amount = useTradingFormStore((s) => s.amount)
  const sliderValue = useTradingFormStore((s) => s.sliderValue)
  const leverage = useTradingFormStore((s) => s.leverage)
  const marginMode = useTradingFormStore((s) => s.marginMode)
  const reduceOnly = useTradingFormStore((s) => s.reduceOnly)
  const maxSlippage = useTradingFormStore((s) => s.maxSlippage)
  const isLeverageModalOpen = useTradingFormStore((s) => s.isLeverageModalOpen)
  const isMarginModeModalOpen = useTradingFormStore(
    (s) => s.isMarginModeModalOpen
  )

  const setSide = useTradingFormStore((s) => s.setSide)
  const setOrderType = useTradingFormStore((s) => s.setOrderType)
  const setOrderPrice = useTradingFormStore((s) => s.setOrderPrice)
  const setLeverage = useTradingFormStore((s) => s.setLeverage)
  const setMarginMode = useTradingFormStore((s) => s.setMarginMode)
  const setReduceOnly = useTradingFormStore((s) => s.setReduceOnly)
  const setMaxSlippage = useTradingFormStore((s) => s.setMaxSlippage)
  const setIsLeverageModalOpen = useTradingFormStore(
    (s) => s.setIsLeverageModalOpen
  )
  const setIsMarginModeModalOpen = useTradingFormStore(
    (s) => s.setIsMarginModeModalOpen
  )
  const handleAmountChangeAction = useTradingFormStore(
    (s) => s.handleAmountChange
  )
  const handleSliderChangeAction = useTradingFormStore(
    (s) => s.handleSliderChange
  )
  const syncOnPriceChange = useTradingFormStore((s) => s.syncOnPriceChange)
  const resetForMarketChange = useTradingFormStore(
    (s) => s.resetForMarketChange
  )

  const positions = usePositionsList()
  const currentMarketPosition = useCurrentMarketPosition(pair.name)
  const { data: balanceData, refetch: refetchBalance } = useBalance()
  const { address } = useAppKitAccount({ namespace: "solana" })
  const { isAuthenticated } = useAuthContext()
  const setDepositOpen = useDepositWithdrawModal((s) => s.setDepositOpen)
  const showDepositCta = useShowDepositCta()
  const setWithdrawOpen = useDepositWithdrawModal((s) => s.setWithdrawOpen)
  const { data: openOrdersData } = useOpenPerpOrders()

  // Fetch order book details for leverage settings
  const { data: orderBookDetailsData } = useOrderBookDetails()
  const { data: accountData } = useAccount()

  // Derive per-market leverage settings
  const marketLeverageConfig = useMemo(() => {
    const detail = orderBookDetailsData?.order_book_details?.find(
      (d) => d.symbol === pair.name
    )
    const maxLeverage = detail
      ? imfToLeverage(detail.min_initial_margin_fraction)
      : 20

    // Use user's saved IMF from /account if authenticated
    const accountPosition = isAuthenticated
      ? accountData?.accounts?.[0]?.positions?.find(
          (p) => p.symbol === pair.name
        )
      : undefined
    if (accountPosition) {
      const userImfPercent = parseFloat(accountPosition.initial_margin_fraction)
      if (userImfPercent > 0) {
        return {
          defaultLeverage: Math.round(100 / userImfPercent),
          maxLeverage,
        }
      }
    }

    // Fallback to orderBookDetails default
    const defaultLeverage = detail
      ? imfToLeverage(detail.default_initial_margin_fraction)
      : 10
    return { defaultLeverage, maxLeverage }
  }, [orderBookDetailsData, accountData, pair.name, isAuthenticated])

  // Initialize leverage when the (market, account-snapshot) pair changes.
  // We must re-init when /account first arrives so the user's saved IMF
  // replaces the pre-auth fallback. Tracking the snapshot alongside the
  // market also covers logout/re-auth without resetting on plain refetches.
  const leverageInitKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (isAuthenticated && !accountData) return // wait for /account
    const accountSnapshot = accountData ? "auth" : "anon"
    const key = `${pair.name}:${accountSnapshot}`
    if (leverageInitKeyRef.current === key) return
    leverageInitKeyRef.current = key
    setLeverage(marketLeverageConfig.defaultLeverage)
  }, [
    pair.name,
    isAuthenticated,
    accountData,
    marketLeverageConfig.defaultLeverage,
    setLeverage,
  ])

  // Get mark price from store
  const storeMarkPrice = useMarkPriceStore(selectMarkPrice(pair.name))

  // Capture mark price once for display (no continuous updates)
  const initialMarkPriceRef = useRef<number | null>(null)
  const hasInitializedLimitPriceRef = useRef(false)
  const inputSourceRef = useRef<"base" | "quote">("base")
  const sourceQuoteRef = useRef("")

  // Capture initial mark price when data arrives (only once per market)
  useEffect(() => {
    if (storeMarkPrice > 0 && initialMarkPriceRef.current === null) {
      initialMarkPriceRef.current = storeMarkPrice
    }
  }, [storeMarkPrice])

  // Reset captured mark price when market changes
  useEffect(() => {
    initialMarkPriceRef.current = null
    hasInitializedLimitPriceRef.current = false
  }, [pair.name])

  // Use captured mark price for display (no 5-second auto-update)
  const markPrice = initialMarkPriceRef.current ?? storeMarkPrice

  // Parse price to number
  const priceNum = useMemo(() => parsePriceInput(orderPrice), [orderPrice])

  // Initialize limit price with mark price when switching to Limit order type
  useEffect(() => {
    if (
      orderType === "Limit" &&
      markPrice > 0 &&
      !hasInitializedLimitPriceRef.current
    ) {
      setOrderPrice(markPrice.toString())
      hasInitializedLimitPriceRef.current = true
    }
  }, [orderType, markPrice, setOrderPrice])

  // Reset initialization flag when switching away from Limit
  useEffect(() => {
    if (orderType === "Market") {
      hasInitializedLimitPriceRef.current = false
    }
  }, [orderType])

  // Display price: for Market orders use live mark price with slippage (matches backend margin lock)
  // Long: locks margin at slippage ceiling (markPrice × 1.005)
  // Short: locks margin at best_bid, but we approximate with slippage floor
  const displayPrice = useMemo(() => {
    if (orderType === "Market") {
      const slippageMultiplier =
        side === "Long" ? 1 + maxSlippage / 100 : 1 - maxSlippage / 100
      return storeMarkPrice * slippageMultiplier
    }
    return priceNum
  }, [orderType, storeMarkPrice, priceNum, side, maxSlippage])

  const hasActiveOrdersOrPositions = useMemo(() => {
    const hasPositions = positions.some((position) => {
      return position.market === pair.name
    })
    const hasOrders = openOrdersData?.orders.some((order) => {
      return order.market === pair.name
    })
    return hasPositions || hasOrders
  }, [positions, openOrdersData, pair.name])

  // Compute available balance for the active market's quote token. Multi-token
  // (ELP-133): the collateral that backs an order is the market's quote token,
  // so we match on asset_id rather than picking the first perp balance.
  const availableQuoteRaw = useMemo(() => {
    const balances = balanceData?.balances ?? []
    const quoteBalance = balances.find(
      (balance: Balance) => balance.asset_id === pair.quote_currency
    )
    return quoteBalance ? parseFloat(quoteBalance.available) : 0
  }, [balanceData, pair.quote_currency])

  // Opening taker-fee rate (fraction, e.g. 0.0005). `taker_fee` is in FEE_TICK
  // units (1 tick = 0.0001%).
  const takerFeeRate = useMemo(() => {
    const d = orderBookDetailsData?.order_book_details?.find(
      (x) => x.symbol === pair.name
    )
    return d ? parseFloat(d.taker_fee) / FEE_TICK : 0
  }, [orderBookDetailsData, pair.name])

  // Balance usable for *new margin* when sizing an order. The backend locks
  // `margin + opening fee`, so sizing to use 100% of the balance as margin
  // leaves nothing for the fee and the order is rejected as "insufficient
  // margin". Discounting by (1 + leverage*feeRate) makes the max order's
  // margin + fee land exactly at the available balance, so a 100% slider is
  // actually placeable. Uses the (higher) taker fee so a passive limit order
  // is never under-reserved. NOTE: this is for sizing only — the displayed
  // `Avbl` still uses the full `availableQuoteRaw`.
  const availableForOrder = useMemo(
    () => availableQuoteRaw / (1 + leverage * takerFeeRate),
    [availableQuoteRaw, leverage, takerFeeRate]
  )

  const availableQuote = useMemo(
    () => formatBalance(availableQuoteRaw),
    [availableQuoteRaw]
  )

  // Calculate reduceable amount based on current position
  const reduceableAmount = useMemo(() => {
    if (currentMarketPosition) {
      return Number(currentMarketPosition.size)
    }
    return 0
  }, [currentMarketPosition])

  // Size of opposite-side position (closes without margin)
  const oppositePositionSize = useMemo(() => {
    if (currentMarketPosition && currentMarketPosition.side !== side) {
      return Number(currentMarketPosition.size)
    }
    return 0
  }, [currentMarketPosition, side])

  // Reset when pair changes — use mark price if available, otherwise empty
  useEffect(() => {
    const data = useMarkPriceStore.getState().markPrices.get(pair.name)
    const price = data?.mark_price ? parseFloat(data.mark_price) : 0
    resetForMarketChange(price > 0 ? price.toString() : "")
  }, [pair.name, resetForMarketChange])

  // Sync orderPrice from orderbook price click (price only, no amount recalc)
  const fromOrderbookRef = useRef(false)
  useEffect(() => {
    if (selectedPrice) {
      fromOrderbookRef.current = true
      setOrderPrice(selectedPrice)
    }
  }, [selectedPrice, setOrderPrice])

  // Sync slider/amount when price changes (skip if from orderbook click)
  useEffect(() => {
    if (fromOrderbookRef.current) {
      fromOrderbookRef.current = false
      return
    }
    syncOnPriceChange(availableForOrder, baseDecimals)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only sync when orderPrice changes
  }, [orderPrice])

  // Recalculate slider when available balance changes (after order placed/cancelled)
  useEffect(() => {
    if (amount && displayPrice > 0) {
      handleAmountChange(amount)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only react to balance changes
  }, [availableQuoteRaw])

  // Sync between base amount and quoteInput depending on which is source of truth
  useEffect(() => {
    if (sizeUnit !== "base" && !quoteInputRef.current) {
      // Slider or external change → sync quoteInput from base amount
      syncQuoteInput(amount)
    }
  }, [amount]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sourceQuote = sourceQuoteRef.current
    if (inputSourceRef.current === "quote" && sourceQuote) {
      const quoteValue = Number.parseFloat(sourceQuote)
      if (displayPrice > 0 && quoteValue > 0) {
        handleAmountChange((quoteValue / displayPrice).toFixed(baseDecimals))
      }
    } else if (inputSourceRef.current === "base" && sizeUnit !== "base") {
      syncQuoteInput(amount)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPrice])

  // Refetch balance when pair changes
  useEffect(() => {
    if (isAuthenticated) {
      refetchBalance()
    }
  }, [pair.id, pair.name, address, refetchBalance, isAuthenticated])

  // Adjust amount when reduceOnly changes
  useEffect(() => {
    const newAmount =
      Number(amount) > reduceableAmount ? reduceableAmount.toString() : amount
    handleAmountChangeAction(
      newAmount,
      displayPrice,
      availableForOrder,
      reduceableAmount,
      oppositePositionSize
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only react to reduceOnly toggle
  }, [reduceOnly])

  const isReduceable = () => {
    if (!reduceOnly) return true
    return currentMarketPosition?.side !== side
  }

  const syncQuoteInput = (baseAmount: string) => {
    const baseNum = Number.parseFloat(baseAmount || "0")
    if (displayPrice > 0 && baseNum > 0) {
      setQuoteInput((displayPrice * baseNum).toFixed(quoteDecimals))
    } else {
      setQuoteInput("")
    }
  }

  const handleSliderChange = (value: number) => {
    inputSourceRef.current = "base"
    sourceQuoteRef.current = ""
    // The slider is now the source of truth — clear the "user is typing in the
    // quote input" flag so the [amount] sync effect refreshes `quoteInput` from
    // the slider-derived amount. Without this, a value typed into the EL$ input
    // before dragging the slider stays frozen while the order size updates.
    quoteInputRef.current = false
    handleSliderChangeAction(
      value,
      displayPrice,
      availableForOrder,
      reduceableAmount,
      oppositePositionSize,
      baseDecimals
    )
  }

  const handleAmountChange = (value: string) => {
    handleAmountChangeAction(
      value,
      displayPrice,
      availableForOrder,
      reduceableAmount,
      oppositePositionSize
    )
  }

  // Market orders price off the live mark (displayPrice = mark × slippage),
  // which drifts every tick. When the user sized via the slider, recompute the
  // amount as the price moves so the notional stays pinned to the chosen %.
  // Otherwise a size frozen at drag-time creeps over the max on an up-tick and
  // shows a false "Not Enough Margin" (the order would still submit, but the
  // button reads as blocked). Only runs when the slider is the active source —
  // never while the user is typing an amount.
  useEffect(() => {
    if (orderType !== "Market") return
    if (sliderValue <= 0) return
    if (useTradingFormStore.getState().lastChangeType !== "slider") return
    handleSliderChange(sliderValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute size on mark drift
  }, [displayPrice, orderType])

  // Create Order Hook
  const createOrder = useCreatePerpOrder()

  const getOrderPrice = (): string => {
    if (orderType === "Market") {
      // Use live mark price for slippage calculation, not the stale captured one
      const livePrice = useMarkPriceStore.getState().markPrices.get(pair.name)
      const currentMarkPrice = livePrice?.mark_price
        ? parseFloat(livePrice.mark_price)
        : markPrice
      const slippageMultiplier =
        side === "Long" ? 1 + maxSlippage / 100 : 1 - maxSlippage / 100
      return (currentMarkPrice * slippageMultiplier).toString()
    }
    return priceNum.toString()
  }

  const handleSubmit = () => {
    let baseAmount = Number.parseFloat(amount).toString()
    // For reduce-only: if amount >= position size, use exact position size to avoid dust
    if (
      reduceOnly &&
      reduceableAmount > 0 &&
      Number.parseFloat(amount) >= reduceableAmount
    ) {
      baseAmount = String(reduceableAmount)
    }
    const price = getOrderPrice()

    createOrder.mutate(
      {
        market: pair.name,
        side,
        is_ask: sideToIsAsk(side),
        price,
        size: baseAmount,
        base_amount: baseAmount,
        order_type: orderType === "Limit" ? 0 : 1,
        reduce_only: reduceOnly,
        margin_mode: 1,
      },
      {
        onSuccess: (data) => {
          // For Market orders the submitted price is the slippage ceiling
          // (mark × 1.005), not the fill price. Show live mark instead, with
          // an "≈" prefix so the user knows it's approximate.
          const livePrice = useMarkPriceStore
            .getState()
            .markPrices.get(pair.name)?.mark_price
          const liveMark = livePrice ? parseFloat(livePrice) : 0
          const isMarket = orderType === "Market"
          const toastPrice =
            isMarket && liveMark > 0 ? liveMark : Number.parseFloat(price)
          // A Market (IOC) order that fills nothing still returns HTTP 200
          // (status cancelled, filled_base_amount "0") — no position is
          // created. Surface it as a failure instead of a misleading "Open"
          // success. Limit (GTC) orders rest on the book, so a 0-fill there
          // is legitimately "Open" and must not be treated as a failure.
          if (isMarket && parseFloat(data?.filled_base_amount ?? "0") === 0) {
            tradingToast.orderFailed({
              market: pair.name,
              side,
              orderType,
              size: baseAmount,
              baseCurrency,
              price: toastPrice,
              approximate: isMarket,
              reason:
                "Not enough liquidity to fill at market. Try a smaller size or a limit order.",
            })
            return
          }
          tradingToast.orderSubmitted({
            market: pair.name,
            side,
            orderType,
            size: baseAmount,
            baseCurrency,
            price: toastPrice,
            approximate: isMarket,
          })
          // Clear the size input + slider after the order is placed. Otherwise
          // a partially-filled market order (e.g. 6 BTC requested, thin book
          // fills 0.25, the IOC remainder is cancelled) leaves the stale 6 BTC
          // in the box — which now reads as "Not Enough Margin" against the
          // reduced balance + the new position. Resetting matches CEX behaviour
          // (size clears once an order is submitted).
          handleAmountChange("")
          if (orderType === "Market") {
            useHistoryTabStore.getState().setActiveTab("positions")
          } else {
            useHistoryTabStore.getState().setActiveTab("open-orders")
          }
        },
        onError: (error) => {
          const livePrice = useMarkPriceStore
            .getState()
            .markPrices.get(pair.name)?.mark_price
          const liveMark = livePrice ? parseFloat(livePrice) : 0
          const isMarket = orderType === "Market"
          const toastPrice =
            isMarket && liveMark > 0 ? liveMark : Number.parseFloat(price)
          // Surface the backend's actual rejection reason instead of a bare
          // "Failed". `toOrderErrorReason` unwraps the Rust `BadRequest("...")`
          // wrapper, maps known errors to friendly copy, and falls back to the
          // cleaned raw message for anything unrecognised.
          const reason = toOrderErrorReason(error)
          tradingToast.orderFailed({
            market: pair.name,
            side,
            orderType,
            size: baseAmount,
            baseCurrency,
            price: toastPrice,
            approximate: isMarket,
            reason,
          })
        },
      }
    )
  }

  // Position-size unit defaults to the QUOTE/collateral currency (EL$, USDC,
  // …): users think in "how much money am I putting in", not in BTC units.
  // "base" stays the internal order unit — the quote input is converted before
  // submit — and remains selectable in the dropdown.
  const [sizeUnit, setSizeUnit] = useState("quote")
  const [quoteInput, setQuoteInput] = useState("")
  const quoteInputRef = useRef(false) // true while user is typing in non-base mode

  const sizeMaxLength = useMemo(() => {
    const config: Record<string, { base: number; quote: number }> = {
      BTC: { base: 10, quote: 12 },
      ETH: { base: 11, quote: 12 },
    }
    const marketConfig = config[pair.base]
    if (marketConfig) {
      return sizeUnit === "base" ? marketConfig.base : marketConfig.quote
    }
    return 12
  }, [pair.base, sizeUnit])

  const isBuy = side === "Long"
  const availableBalance = availableQuote
  const availableCurrency = quoteCurrency

  // Margin the order needs to be *accepted* (R1). The backend locks margin for
  // the order's FULL size at submission and only releases the closed portion
  // after matching (R2) — it does NOT net an opposite position to close at R1.
  // So placeability must require the full notional, matching what the backend
  // accepts. (To close a position without locking margin, use Reduce Only,
  // which the engine charges 0 margin for.)
  const getNetMarginRequired = (total: number) => {
    if (reduceOnly) return 0
    return total
  }

  const isPlaceable = () => {
    // Market-mode gates first (ELP-499): halted blocks everything; a closed
    // FX session accepts only reduce-only orders (position exits stay open —
    // do NOT lump this with "trading disabled").
    if (marketMode === "halted") return false
    if (marketMode === "reduce_only" && !reduceOnly) return false
    const total = displayPrice * Number.parseFloat(amount || "0")
    if (total <= 0) return false
    if (total < MIN_ORDER_VALUE_USD) return false
    if (sizeUnit !== "base") {
      const quoteValue = Number.parseFloat(quoteInput || "0")
      const minQuoteAmount = displayPrice / (pair.base_scale_k || 100000)
      if (quoteValue > 0 && quoteValue < minQuoteAmount) return false
    }
    const maxNotional = availableForOrder * leverage
    const netRequired = getNetMarginRequired(total)
    // Allow small floating-point tolerance (0.01%) to avoid false "not enough margin"
    if (netRequired > maxNotional * 1.0001) return false
    if (createOrder.isPending) return false
    if (!isReduceable()) return false
    if (reduceOnly && reduceableAmount < total / displayPrice) return false
    return true
  }

  const getButtonText = () => {
    if (marketMode === "halted") return "Trading Halted"
    if (marketMode === "reduce_only" && !reduceOnly)
      return "Market Closed — Reduce Only"
    const total = displayPrice * Number.parseFloat(amount || "0")
    // "Did the user type a positive amount in the active unit?" — checked on
    // the raw input, not the rounded base. A tiny quote (EL$) input rounds the
    // derived base to 0 (and `total` to 0); without this it would fall through
    // to "Enter Amount" even though the user clearly entered something. We
    // still compare the threshold against `total` (the rounded, actually-
    // placeable notional) so a sub-$1 quote that rounds UP to a valid order
    // isn't falsely blocked.
    const enteredAmount =
      sizeUnit === "base"
        ? Number.parseFloat(amount || "0") > 0
        : Number.parseFloat(quoteInput || "0") > 0
    if (enteredAmount && total < MIN_ORDER_VALUE_USD)
      return `Minimum order value is $${MIN_ORDER_VALUE_USD}`
    if (total <= 0) return "Enter Amount"
    if (sizeUnit !== "base") {
      const quoteValue = Number.parseFloat(quoteInput || "0")
      const minQuoteAmount = displayPrice / (pair.base_scale_k || 100000)
      if (quoteValue > 0 && quoteValue < minQuoteAmount) return "Enter Amount"
    }
    if (reduceOnly && reduceableAmount < total / displayPrice)
      return "Reduce Only Too Large"
    const maxNotional = availableForOrder * leverage
    const netRequired = getNetMarginRequired(total)
    if (netRequired > maxNotional * 1.0001) return "Not Enough Margin"
    if (createOrder.isPending) return "Submitting..."
    if (orderType === "Limit" && (orderPrice === "" || orderPrice === null))
      return "Enter Limit Price"
    if (amount === "" || Number.parseFloat(amount) <= 0) return "Enter Amount"
    return `Place ${orderType} Order`
  }

  // Available-balance readout ("Avbl 0.00 EL$"), rendered inline on the Price
  // label row (Limit) or the Position Size label row (Market).
  const avblLabel = (
    <span className="text-xs text-muted-foreground">
      Avbl{" "}
      <span className="font-mono text-foreground">
        {availableBalance} {availableCurrency}
      </span>
    </span>
  )

  return (
    <div className="flex min-h-0 h-full flex-col overflow-y-auto rounded-lg border border-border bg-card w-56 md:w-64 lg:w-72 xl:w-[320px] p-3">
      {/* Leverage and Margin Mode Selector */}
      <div className="flex gap-2 mb-2">
        {/* Leverage Selector */}
        <button
          data-testid="adjust-leverage"
          onClick={() => {
            if (isAuthenticated) setIsLeverageModalOpen(true)
          }}
          disabled={!isAuthenticated}
          className="group inline-flex h-8 w-fit flex-1 cursor-pointer items-center justify-between gap-1.5 truncate rounded-[6px] border border-border bg-muted/30 p-2 text-xs/none font-medium text-foreground transition-all hover:border-foreground/40 hover:bg-muted/60 active:border-foreground/30 disabled:cursor-auto disabled:opacity-50"
        >
          <span>{orderBookDetailsData ? `${leverage}x` : "-"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {/* Margin Mode Selector */}
        <button
          data-testid="adjust-margin-mode"
          onClick={() => {
            setIsMarginModeModalOpen(true)
          }}
          aria-label={`Change margin mode to ${marginMode === "Cross" ? "Isolated" : "Cross"}`}
          className="group inline-flex h-8 w-fit flex-1 cursor-pointer items-center justify-between gap-1.5 truncate rounded-[6px] border border-border bg-muted/30 p-2 text-xs/none font-medium text-foreground transition-all hover:border-foreground/40 hover:bg-muted/60 active:border-foreground/30 disabled:cursor-auto disabled:border-border disabled:opacity-50"
        >
          <span>{marginMode}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {/* Market-mode banner (ELP-499) — FX-session markets only; 24/7
          markets never leave "active" so this never renders for them.
          Colors follow the severity: halted = red (nothing tradeable,
          prices untrusted), reduce_only = amber (exits still allowed). */}
      {marketMode === "halted" && (
        <div className="mb-2 rounded-md border border-[#f15044]/40 bg-[#f15044]/10 px-3 py-2 text-xs leading-snug text-[#f15044]">
          Trading is halted — waiting for a fresh oracle price. New and amended
          orders are rejected; you can still cancel open orders. Displayed
          prices may be stale.
        </div>
      )}
      {marketMode === "reduce_only" && (
        <div className="mb-2 rounded-md border border-[#f5a623]/40 bg-[#f5a623]/10 px-3 py-2 text-xs leading-snug text-[#f5a623]">
          Market closed (FX session) — only reduce-only orders are accepted
          until it reopens. Enable “Reduce Only” below to close or trim a
          position.
        </div>
      )}

      {/* Side Selector — segmented toggle. Active side gets a tinted pill
          (color/15 fill + full-color border + full-color text); the inactive
          side shows its own semantic color at reduced opacity. */}
      <div className="mb-2 flex gap-1 rounded-lg border border-border bg-background p-0.5">
        <button
          onClick={() => setSide("Long")}
          className={`flex-1 cursor-pointer rounded-md border px-4 py-1.5 text-sm font-medium transition-colors max-md:py-1 ${
            side === "Long"
              ? "border-[#24ffcc] bg-success/15 text-success"
              : "border-transparent text-success/70 hover:text-success"
          }`}
        >
          Buy / Long
        </button>
        <button
          onClick={() => setSide("Short")}
          className={`flex-1 cursor-pointer rounded-md border px-4 py-1.5 text-sm font-medium transition-colors max-md:py-1 ${
            side === "Short"
              ? "border-destructive bg-destructive/15 text-destructive"
              : "border-transparent text-destructive/70 hover:text-destructive"
          }`}
        >
          Sell / Short
        </button>
      </div>

      {/* Order Form */}
      {/* max-md: tighter padding/rhythm — on small phones the desktop
          spacing made the order sheet feel oversized and scroll-heavy. */}
      <div className="p-4 space-y-4 max-md:p-3 max-md:space-y-2.5">
        {/* Order Type Selector */}
        <div className="flex gap-4 text-sm">
          {orderTypeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setOrderType(option.value)}
              className={`relative cursor-pointer pb-1.5 font-medium transition-colors ${
                orderType === option.value
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
              {/* Active underline (Figma): #0086fc bar under the selected tab. */}
              {orderType === option.value && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#0086fc]" />
              )}
            </button>
          ))}
        </div>

        {/* Price Input (only for limit orders) */}
        {orderType === "Limit" && (
          <div className="space-y-2">
            {/* Price label row — available balance (`Avbl`) sits inline on the
                right, matching the design. For Market orders (no Price row) the
                same `Avbl` is rendered on the Position Size label row below. */}
            <div className="flex items-center justify-between">
              <Label
                htmlFor="order-price"
                className="text-xs text-muted-foreground"
              >
                Price
              </Label>
              {avblLabel}
            </div>
            <div className="relative">
              <Input
                id="order-price"
                placeholder={`0.${"0".repeat(quoteDecimals)}`}
                value={orderPrice}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return
                  const intPart = raw.split(".")[0]
                  if (intPart.length > priceMaxIntDigits) return
                  if (exceedsDecimals(raw, quoteDecimals)) return
                  setOrderPrice(raw)
                }}
                className="pr-20 font-mono max-md:h-8 max-md:text-sm"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {/*
                  Price is always quoted in USDT terms regardless of which
                  collateral the market is settled in (EL$, ARB, USDT…) —
                  matches the orderbook column header ("Price(USDT)") and
                  the universal BTC/USD oracle feed that drives mark
                  price. Previously this label echoed `quoteCurrency`
                  (the collateral symbol), which read as "you're paying
                  62,666.5 EL$ per BTC" on the BTC-PERP-EL market — true
                  numerically only because EL$ is USD-pegged, but
                  confusing once ARB enters the mix where ARB ≠ $1.
                */}
                <span className="text-xs text-muted-foreground">USDT</span>
              </div>
            </div>
          </div>
        )}

        {/* Position Size Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label
              htmlFor="order-amount"
              className="text-xs text-muted-foreground"
            >
              Position Size
            </Label>
            {/* Market orders have no Price row, so surface `Avbl` here instead
                so the available balance is never hidden. */}
            {orderType === "Market" && avblLabel}
          </div>
          <div className="relative">
            <Input
              id="order-amount"
              autoComplete="off"
              placeholder={
                sizeUnit === "base"
                  ? `0.${"0".repeat(baseDecimals)}`
                  : `0.${"0".repeat(quoteDecimals)}`
              }
              value={sizeUnit === "base" ? amount : quoteInput}
              onFocus={() => {
                if (sizeUnit !== "base") quoteInputRef.current = true
              }}
              onBlur={() => {
                quoteInputRef.current = false
              }}
              onChange={(e) => {
                const raw = e.target.value
                if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return
                if (raw.length > sizeMaxLength) return
                if (sizeUnit === "base") {
                  if (exceedsDecimals(raw, baseDecimals)) return
                  inputSourceRef.current = "base"
                  sourceQuoteRef.current = ""
                  handleAmountChange(raw)
                } else {
                  if (exceedsDecimals(raw, quoteDecimals)) return
                  inputSourceRef.current = "quote"
                  sourceQuoteRef.current = raw
                  quoteInputRef.current = true
                  setQuoteInput(raw)
                  const quoteValue = Number.parseFloat(raw || "0")
                  if (displayPrice > 0 && quoteValue > 0) {
                    const baseValue = quoteValue / displayPrice
                    handleAmountChange(baseValue.toFixed(baseDecimals))
                  } else {
                    handleAmountChange("")
                  }
                }
              }}
              className="pr-24 font-mono max-md:h-8 max-md:text-sm"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <select
                value={sizeUnit}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === "base" && sizeUnit !== "base") {
                    const quoteValue = Number.parseFloat(quoteInput || "0")
                    const minQuoteAmount =
                      displayPrice / (pair.base_scale_k || 100000)
                    if (quoteValue > 0 && quoteValue < minQuoteAmount) {
                      handleAmountChange("")
                    }
                  } else if (next !== "base" && sizeUnit === "base") {
                    if (amount) {
                      syncQuoteInput(amount)
                    }
                  }
                  setSizeUnit(next)
                }}
                className="cursor-pointer bg-transparent text-xs text-muted-foreground outline-none"
              >
                {sizeUnitOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* Min order-value hint — backend rejects notional below $1.
              Gated on a positive raw input (active unit) so a tiny EL$ amount
              that rounds the base to 0 still warns instead of going silent;
              the threshold itself compares the rounded, placeable notional. */}
          {(() => {
            const enteredAmount =
              sizeUnit === "base"
                ? Number.parseFloat(amount || "0") > 0
                : Number.parseFloat(quoteInput || "0") > 0
            const orderValueUsd =
              displayPrice * Number.parseFloat(amount || "0")
            return enteredAmount && orderValueUsd < MIN_ORDER_VALUE_USD ? (
              <p className="text-xs text-destructive">
                Minimum order value is ${MIN_ORDER_VALUE_USD}. Increase the
                amount.
              </p>
            ) : null
          })()}
        </div>

        {/* Slider */}
        <div className="space-y-2">
          <Slider
            value={sliderValue}
            onValueChange={handleSliderChange}
            variant={side === "Long" ? "buy" : "sell"}
            showInput={true}
          />
        </div>

        {/* Reduce Only Checkbox */}
        <label className="flex w-fit cursor-pointer items-center gap-1">
          <input
            data-testid="reduce-only-checkbox"
            className="sr-only"
            type="checkbox"
            checked={reduceOnly}
            onChange={(e) => setReduceOnly(e.target.checked)}
          />
          <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm border text-foreground transition">
            <svg
              className={`transition ${reduceOnly ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-45 opacity-0"}`}
              width="8"
              height="6"
              viewBox="0 0 8 6"
              stroke="currentColor"
              fill="none"
            >
              <path
                d="M1 3L3 5L7 1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-xs">Reduce Only</span>
        </label>

        {/* Zero-balance CTA (Figma 3118-2049): a connected wallet with no
            available quote collateral can never place an order, so every
            submit-button state would read as a dead end ("Not Enough
            Margin"). Route the user to the actual next step instead —
            deposit. (Condition + gradient live in useShowDepositCta, shared
            with the mobile Buy/Sell bar.) */}
        {showDepositCta ? (
          <Button
            className="w-full rounded-[6px] text-sm font-medium text-white hover:opacity-90"
            style={{ backgroundImage: DEPOSIT_CTA_GRADIENT }}
            onClick={() => setDepositOpen(true)}
          >
            Deposit to Trade
          </Button>
        ) : (
          /* Submit Button. Enabled: solid brand fill (Figma — mint #0dbb92 for
             Long, red #f15044 for Short), rounded-[6px]. Disabled (order not yet
             placeable): a muted grey fill so it's clearly distinct from the
             active state; clicks stay blocked via the base `disabled:pointer-events-none`. */
          <Button
            className={
              isPlaceable()
                ? isBuy
                  ? "w-full rounded-[6px] bg-[#0dbb92] hover:bg-[#0dbb92]/90 text-white"
                  : "w-full rounded-[6px] bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : "w-full rounded-[6px] bg-muted text-muted-foreground disabled:opacity-100"
            }
            onClick={handleSubmit}
            disabled={!isPlaceable()}
          >
            {getButtonText()}
          </Button>
        )}

        {/* Order Summary */}
        <OrderSummary
          amount={amount}
          displayPrice={displayPrice}
          leverage={leverage}
          orderType={orderType}
          side={side}
          baseCurrency={baseCurrency}
          maxSlippage={maxSlippage}
          onSlippageChange={setMaxSlippage}
          availableForOrder={availableForOrder}
          baseDecimals={baseDecimals}
        />

        {/* Reduce Only Error Message */}
        {!isReduceable() && (
          <div className="text-xs bg-destructive/10 text-destructive rounded-sm border p-2 break-words min-w-0">
            <span>
              Reduce-only orders can only decrease an existing position. Switch
              to the opposite side.
            </span>
          </div>
        )}

        {/* Deposit / Withdraw — directly below the order summary (Figma
            2236-1780). Opens the shared modals via the store (single instance
            lives in the header); gated on auth like the header wallet menu. */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDepositOpen(true)}
            disabled={!isAuthenticated}
            className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border border-[#2e2e2e] bg-[#161616] text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDown className="h-4 w-4" />
            Deposit
          </button>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            disabled={!isAuthenticated}
            className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border border-[#2e2e2e] bg-[#161616] text-sm font-medium text-muted-foreground transition-colors hover:bg-[#1e1e1e] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4" />
            Withdraw
          </button>
        </div>
      </div>

      {/* Leverage Adjustment Modal */}
      <LeverageModal
        open={isLeverageModalOpen}
        onOpenChange={setIsLeverageModalOpen}
        leverage={leverage}
        onConfirm={setLeverage}
        side={side === "Long" ? "buy" : "sell"}
        market={pair.name}
        maxLeverage={marketLeverageConfig.maxLeverage}
      />

      {/* Margin Mode Modal */}
      <MarginModeModal
        open={isMarginModeModalOpen}
        onOpenChange={setIsMarginModeModalOpen}
        marginMode={marginMode}
        onConfirm={setMarginMode}
        hasActiveOrdersOrPositions={hasActiveOrdersOrPositions}
      />
    </div>
  )
}

/**
 * Walk the orderbook to compute VWAP for a given size.
 * For Long (buy): walk asks ascending. For Short (sell): walk bids descending.
 */
function calcVwap(
  entries: { price: string; size: string }[],
  targetSize: number
): number {
  if (targetSize <= 0 || entries.length === 0) return 0
  let filled = 0
  let cost = 0
  for (const entry of entries) {
    const price = parseFloat(entry.price)
    const size = parseFloat(entry.size)
    const fill = Math.min(size, targetSize - filled)
    cost += fill * price
    filled += fill
    if (filled >= targetSize) break
  }
  return filled > 0 ? cost / filled : 0
}

function OrderSummary({
  amount,
  displayPrice,
  leverage,
  orderType,
  side,
  baseCurrency,
  maxSlippage,
  onSlippageChange,
  availableForOrder,
  baseDecimals,
}: {
  amount: string
  displayPrice: number
  leverage: number
  orderType: PerpOrderType
  side: "Long" | "Short"
  baseCurrency: string
  maxSlippage: number
  onSlippageChange: (v: number) => void
  availableForOrder: number
  baseDecimals: number
}) {
  const pair = useSelectedPair()
  const orderbook = useOrderbook(pair.id)
  const { data: orderBookDetailsData } = useOrderBookDetails()
  const marketDetail = orderBookDetailsData?.order_book_details?.find(
    (d) => d.symbol === pair.name
  )
  // taker/maker fee are in FEE_TICK units (1 tick = 0.0001%).
  const takerFeePercent = marketDetail
    ? (parseFloat(marketDetail.taker_fee) / FEE_TICK) * 100
    : 0
  const makerFeePercent = marketDetail
    ? (parseFloat(marketDetail.maker_fee) / FEE_TICK) * 100
    : 0
  const feeDisplay = `Taker: ${takerFeePercent.toFixed(2)}% | Maker: ${makerFeePercent.toFixed(2)}%`
  const [isSlippageOpen, setIsSlippageOpen] = useState(false)
  const [customSlippage, setCustomSlippage] = useState("")
  const slippageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isSlippageOpen) return
    const handleClick = (e: MouseEvent) => {
      if (
        slippageRef.current &&
        !slippageRef.current.contains(e.target as Node)
      ) {
        setIsSlippageOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [isSlippageOpen])

  // Renamed from `size` to avoid colliding with the `size` local declared
  // inside calcVwap — the React Compiler's scope analysis was conservatively
  // marking this dep as mutable when the names matched.
  const orderSize = Number.parseFloat(amount || "0")
  const orderValue = orderSize * displayPrice
  const positionMargin = orderValue > 0 ? orderValue / leverage : 0

  // Est. liquidation price — mirrors the backend formula so the preview
  // matches the actual position's liq price after fill. Pre-trade, the best
  // proxy for mark price is the display price (limit price for Limit orders,
  // mark × slippage for Market).
  const liqPrice = computeLiquidationPrice({
    side,
    entryPrice: displayPrice,
    size: orderSize,
    margin: positionMargin,
    markPrice: displayPrice,
    mmf: mmfFractionOf(marketDetail),
  })

  // Estimate slippage: VWAP vs best price (first level in the orderbook).
  // React 19's compiler handles memoization automatically — adding our own
  // useMemo here triggered "Existing memoization could not be preserved"
  // because the compiler couldn't reason about whether orderSize would be
  // mutated later (it isn't, but the static analysis can't tell).
  const estSlippage = (() => {
    if (orderType !== "Market" || orderSize <= 0 || !orderbook.data) return 0
    const entries =
      side === "Long"
        ? (orderbook.data.asks ?? [])
        : (orderbook.data.bids ?? [])
    if (entries.length === 0) return 0
    const bestPrice = parseFloat(entries[0].price)
    if (bestPrice <= 0) return 0
    const vwap = calcVwap(entries, orderSize)
    if (vwap <= 0) return 0
    return Math.abs(((vwap - bestPrice) / bestPrice) * 100)
  })()

  const fmt = (v: number, decimals = 2) =>
    v > 0
      ? v.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : "-"

  const fmtUsd = (v: number) => (v > 0 ? `$${fmt(v)}` : "-")

  // Over-cap values are clamped to MAX_SLIPPAGE (shared store policy), not
  // silently ignored, so Confirm always applies a valid value.
  // Sanitize the custom-slippage input: digits only, one decimal point, at most
  // 2 decimal places, and anything ≥ 10 snaps straight to "10".
  const handleCustomSlippageChange = (raw: string) => {
    if (raw === "") {
      setCustomSlippage("")
      return
    }
    if (!/^\d*\.?\d{0,2}$/.test(raw)) return // reject non-numeric / >2 decimals
    const val = parseFloat(raw)
    setCustomSlippage(val > MAX_SLIPPAGE ? String(MAX_SLIPPAGE) : raw)
  }
  const handleCustomSlippage = () => {
    const val = parseFloat(customSlippage)
    if (!Number.isFinite(val) || val <= 0) return
    onSlippageChange(Math.min(val, MAX_SLIPPAGE))
    setIsSlippageOpen(false)
    setCustomSlippage("")
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      {orderType === "Limit" && (
        <SummaryRow
          label="Maximum Order Value"
          value={fmtUsd(availableForOrder * leverage)}
        />
      )}
      <SummaryRow
        label="Order Size"
        value={
          orderSize > 0
            ? `${fmt(orderSize, baseDecimals)} ${baseCurrency}`
            : "-"
        }
      />
      <SummaryRow label="Order Value" value={fmtUsd(orderValue)} />
      <SummaryRow
        label="Est. Liq. Price"
        value={liqPrice > 0 ? fmtUsd(liqPrice) : "-"}
      />
      <SummaryRow label="Position Margin" value={fmtUsd(positionMargin)} />

      {/* Slippage row with edit toggle (Market orders only) */}
      {orderType === "Market" && (
        <div ref={slippageRef}>
          <div className="flex w-full justify-between items-center">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Slippage
            </span>
            <button
              type="button"
              onClick={() => setIsSlippageOpen(!isSlippageOpen)}
              className="inline-flex items-center gap-1 text-xs tabular-nums text-primary hover:text-primary/80 transition-colors cursor-pointer"
            >
              <span>
                Est: {estSlippage.toFixed(2)}% | Max: {maxSlippage}%
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>

          {/* Slippage editor */}
          {isSlippageOpen && (
            <div className="flex flex-col gap-2 rounded border border-border bg-background p-2">
              <div className="flex gap-1">
                {SLIPPAGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      onSlippageChange(preset)
                      setIsSlippageOpen(false)
                    }}
                    className={`flex-1 rounded px-1.5 py-1 text-[11px] tabular-nums transition-colors ${
                      maxSlippage === preset
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Custom %"
                  value={customSlippage}
                  onChange={(e) => handleCustomSlippageChange(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomSlippage()}
                  className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-xs tabular-nums outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleCustomSlippage}
                  className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <SummaryRow label="Fees" value={feeDisplay} />
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full justify-between">
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {label}
      </span>
      <span className="text-xs tabular-nums text-foreground">{value}</span>
    </div>
  )
}
