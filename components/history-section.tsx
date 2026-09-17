"use client"

import { marketDisplayLabel } from "@/lib/utils/marketLabel"

import { useMemo, useState, useEffect, useRef, useCallback } from "react"
import { useAppKit } from "@reown/appkit/react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { useAuthContext } from "@/lib/providers/AuthProvider"
import { Filter } from "lucide-react"
import type { TabValue, PerpSideFilter, PerpTypeFilter } from "@/types/history"
import { useBalance } from "@/lib/hooks/useBalance"
import { useHistoryTabStore } from "@/lib/stores"
import { useAccountIndex } from "@/lib/hooks/useAccount"
import { usePositionsList } from "@/lib/hooks/usePositions"
import { useOpenPerpOrders } from "@/lib/hooks/useOpenPerpOrders"
import { usePerpOrderHistory } from "@/lib/hooks/usePerpOrderHistory"
import { useCancelPerpOrder } from "@/lib/hooks/useCancelPerpOrder"
import { tradingToast } from "@/lib/utils/toast"
import type { PerpOrder, Trade } from "@/types"
import { PositionsTab } from "@/components/history/PositionsTab"
import { AssetsTab } from "@/components/history/AssetsTab"
import { PerpOpenOrdersTab } from "@/components/history/PerpOpenOrdersTab"
import { PerpOrderHistoryTab } from "@/components/history/PerpOrderHistoryTab"
import { TradeHistoryTab } from "@/components/history/TradeHistoryTab"
import { FundingHistoryTab } from "@/components/history/FundingHistoryTab"
import { DepositsTab } from "@/components/history/DepositsTab"
import { WithdrawalsTab } from "@/components/history/WithdrawalsTab"
import { useTrades } from "@/lib/hooks/useTrades"
import { useWithdrawalHistory } from "@/lib/hooks/useWithdrawalHistory"
import { useDepositHistory } from "@/lib/hooks/useDepositHistory"

export function HistorySection() {
  const { isAuthenticated } = useAuthContext()
  const { open: openConnectModal } = useAppKit()
  const activeTab = useHistoryTabStore((s) => s.activeTab)
  const setActiveTab = useHistoryTabStore((s) => s.setActiveTab)
  const [sideFilter, setSideFilter] = useState<PerpSideFilter>("all")
  const [typeFilter, setTypeFilter] = useState<PerpTypeFilter>("all")
  const [isAggregated, setIsAggregated] = useState(false)

  // Data hooks
  const { data: balance } = useBalance()
  const positions = usePositionsList()
  const accountIndex = useAccountIndex()
  const { data: openOrdersData, refetch: refetchOpenOrders } =
    useOpenPerpOrders()
  const { data: orderHistoryData, refetch: refetchOrderHistory } =
    usePerpOrderHistory()
  const { data: tradesData, refetch: refetchTrades } = useTrades(isAggregated)
  const {
    data: withdrawalsData,
    hasNextPage: hasNextWithdrawals,
    isFetchingNextPage: isFetchingNextWithdrawals,
    fetchNextPage: fetchNextWithdrawals,
  } = useWithdrawalHistory()
  const {
    data: depositsData,
    hasNextPage: hasNextDeposits,
    isFetchingNextPage: isFetchingNextDeposits,
    fetchNextPage: fetchNextDeposits,
  } = useDepositHistory()
  const cancelPerpOrder = useCancelPerpOrder()

  // Tab counts (exclude closed positions with size 0)
  const positionsCount = positions.filter(
    (p) => parseFloat(p.size) !== 0
  ).length
  const assetsCount = balance?.balances?.length ?? 0
  const openOrdersCount = openOrdersData?.orders?.length ?? 0

  // Filter by side
  const filteredPositions = useMemo(() => {
    if (sideFilter === "all") return positions
    return positions.filter((pos) => pos.side === sideFilter)
  }, [positions, sideFilter])

  const filteredOpenOrders = useMemo(() => {
    if (!openOrdersData?.orders) return []
    return openOrdersData.orders.filter((order) => {
      if (sideFilter !== "all" && order.side !== sideFilter) return false
      if (typeFilter !== "all" && order.order_type.toLowerCase() !== typeFilter)
        return false
      return true
    })
  }, [openOrdersData, sideFilter, typeFilter])

  const filteredOrderHistory = useMemo(() => {
    if (!orderHistoryData?.orders) return []
    return orderHistoryData.orders.filter((order) => {
      if (sideFilter !== "all" && order.side !== sideFilter) return false
      if (typeFilter !== "all" && order.order_type.toLowerCase() !== typeFilter)
        return false
      return true
    })
  }, [orderHistoryData, sideFilter, typeFilter])

  const filteredTrades = useMemo(() => {
    if (!tradesData?.trades) return []
    if (sideFilter === "all") return tradesData.trades
    return tradesData.trades.filter((trade: Trade) => {
      const isMaker =
        accountIndex != null && trade.maker_account_id === accountIndex
      const isBuy = isMaker ? !trade.is_maker_ask : trade.is_maker_ask
      const positionSizeBefore = parseFloat(
        isMaker
          ? trade.maker_position_size_before
          : trade.taker_position_size_before
      )
      const isLong = positionSizeBefore > 0
      const isClose = positionSizeBefore !== 0 && isLong !== isBuy
      const action = isClose
        ? isLong
          ? "Close Long"
          : "Close Short"
        : isBuy
          ? "Open Long"
          : "Open Short"
      const isLongSide = action.includes("Long")
      return sideFilter === "Long" ? isLongSide : !isLongSide
    })
  }, [tradesData, sideFilter, accountIndex])

  const handleCancelOrder = (order: PerpOrder) => {
    const side = order.side
    cancelPerpOrder.mutate(
      {
        order_id: order.id,
        market: order.market,
      },
      {
        onSuccess: () => {
          tradingToast.orderCancelled({
            market: order.market,
            side,
            orderType: order.order_type,
            size: order.initial_base_amount,
            baseCurrency: marketDisplayLabel(order.market),
            price: parseFloat(order.price),
          })
        },
        onError: () => {
          tradingToast.error("Cancel failed", "Could not cancel order")
        },
      }
    )
  }

  // Scroll fade indicator
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollFade, setShowScrollFade] = useState(false)

  const checkScrollFade = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const hasOverflow = el.scrollHeight > el.clientHeight
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    setShowScrollFade(hasOverflow && !isAtBottom)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", checkScrollFade)
    const observer = new ResizeObserver(checkScrollFade)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", checkScrollFade)
      observer.disconnect()
    }
  }, [checkScrollFade, activeTab])

  // Refetch data when tab changes
  useEffect(() => {
    if (isAuthenticated) {
      switch (activeTab) {
        case "open-orders":
          refetchOpenOrders()
          break
        case "order-history":
          refetchOrderHistory()
          break
        case "trade-history":
          refetchTrades()
          break
      }
    }
  }, [
    activeTab,
    refetchOpenOrders,
    refetchOrderHistory,
    refetchTrades,
    isAuthenticated,
  ])

  const getTabLabel = (value: TabValue, label: string) => {
    let count = 0
    switch (value) {
      case "positions":
        count = positionsCount
        break
      case "assets":
        count = assetsCount
        break
      case "open-orders":
        count = openOrdersCount
        break
      default:
        return label
    }
    return count > 0 ? `${label} (${count})` : label
  }

  const tabs = [
    { value: "positions" as TabValue, label: "Positions" },
    { value: "assets" as TabValue, label: "Assets" },
    { value: "open-orders" as TabValue, label: "Open Orders" },
    { value: "order-history" as TabValue, label: "Order History" },
    { value: "trade-history" as TabValue, label: "Trade History" },
    { value: "funding-history" as TabValue, label: "Funding History" },
    { value: "deposits" as TabValue, label: "Deposits" },
    { value: "withdrawals" as TabValue, label: "Withdrawals" },
  ]

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
        className="flex h-full flex-col gap-2"
      >
        {/* Tab Navigation */}
        <div className="flex justify-between gap-2 rounded-sm max-[850px]:flex-col">
          <TabsList className="flex h-fit min-h-8 w-full items-center justify-start overflow-x-auto p-1 bg-card min-[851px]:w-fit">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="relative h-8 min-h-8 w-auto cursor-pointer rounded-md border border-transparent p-2 text-xs font-normal text-nowrap text-[#808080] transition-colors hover:text-foreground data-[state=active]:border-[#333] data-[state=active]:bg-[#222] data-[state=active]:text-[#eee]"
              >
                {getTabLabel(tab.value, tab.label)}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Filters */}
          {(activeTab === "positions" ||
            activeTab === "open-orders" ||
            activeTab === "order-history" ||
            activeTab === "trade-history" ||
            activeTab === "funding-history") && (
            <div className="flex h-full items-center gap-2 px-2">
              {/* Side Filter — icon buttons */}
              <div className="flex gap-1">
                <button
                  onClick={() => setSideFilter("all")}
                  className={`flex size-5 cursor-pointer items-center justify-center rounded-sm p-1 hover:bg-muted ${sideFilter === "all" ? "bg-muted" : "opacity-50"}`}
                  aria-label="all"
                >
                  <svg viewBox="0 0 12 12" fill="none" className="size-3">
                    <rect
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-destructive"
                    />
                    <rect
                      y="7"
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-success"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setSideFilter("Short")}
                  className={`flex size-5 cursor-pointer items-center justify-center rounded-sm p-1 hover:bg-muted ${sideFilter === "Short" ? "bg-muted" : "opacity-50"}`}
                  aria-label="short"
                >
                  <svg viewBox="0 0 12 12" fill="none" className="size-3">
                    <rect
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-destructive"
                    />
                    <rect
                      y="7"
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-destructive"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => setSideFilter("Long")}
                  className={`flex size-5 cursor-pointer items-center justify-center rounded-sm p-1 hover:bg-muted ${sideFilter === "Long" ? "bg-muted" : "opacity-50"}`}
                  aria-label="long"
                >
                  <svg viewBox="0 0 12 12" fill="none" className="size-3">
                    <rect
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-success"
                    />
                    <rect
                      y="7"
                      width="12"
                      height="5"
                      rx="1"
                      className="fill-success"
                    />
                  </svg>
                </button>
              </div>

              {/* Aggregate toggle (trade-history only) */}
              {activeTab === "trade-history" && (
                <label className="flex w-fit cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isAggregated}
                    onChange={() => setIsAggregated(!isAggregated)}
                  />
                  <span
                    className={`flex size-2.5 shrink-0 items-center justify-center rounded-[2px] border ${
                      isAggregated
                        ? "border-primary bg-primary"
                        : "border-muted-foreground bg-transparent"
                    }`}
                  >
                    {isAggregated && (
                      <svg
                        className="transition"
                        width="6"
                        height="5"
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
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Aggregate
                  </span>
                </label>
              )}

              {/* Type Filter (open-orders only) */}
              {activeTab === "open-orders" && (
                <Select
                  value={typeFilter}
                  onValueChange={(value) =>
                    setTypeFilter(value as PerpTypeFilter)
                  }
                >
                  <SelectTrigger className="mx-1 h-8 w-fit gap-1 px-0 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=open]:text-foreground border-none cursor-pointer">
                    <div className="flex items-center gap-1 p-2">
                      <Filter className="size-3 shrink-0" />
                      <span>Type</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent side="bottom" position="popper">
                    <SelectItem value="all" className="cursor-pointer">
                      All
                    </SelectItem>
                    <SelectItem value="limit" className="cursor-pointer">
                      Limit
                    </SelectItem>
                    {/* TODO: Enable after backend supports S/L and T/P order types */}
                    <SelectItem
                      value="sl_market"
                      className="cursor-pointer"
                      disabled
                    >
                      S/L Market
                    </SelectItem>
                    <SelectItem
                      value="sl_limit"
                      className="cursor-pointer"
                      disabled
                    >
                      S/L Limit
                    </SelectItem>
                    <SelectItem
                      value="tp_market"
                      className="cursor-pointer"
                      disabled
                    >
                      T/P Market
                    </SelectItem>
                    <SelectItem
                      value="tp_limit"
                      className="cursor-pointer"
                      disabled
                    >
                      T/P Limit
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* Tab Content */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="scrollbar-thin flex h-full flex-col overflow-auto"
            data-testid="user-orders-table"
          >
            {!isAuthenticated ? (
              <div className="flex items-start justify-start p-3 text-left max-md:flex-1 max-md:items-center max-md:justify-center max-md:p-0">
                <span className="text-sm text-foreground max-md:m-auto">
                  You need to{" "}
                  <button
                    onClick={() => openConnectModal()}
                    className="cursor-pointer underline hover:text-primary"
                  >
                    authenticate
                  </button>{" "}
                  to see your {activeTab.replace("-", " ")}.
                </span>
              </div>
            ) : (
              <>
                <TabsContent value="positions" className="h-full">
                  <PositionsTab positions={filteredPositions} />
                </TabsContent>
                <TabsContent value="assets" className="h-full">
                  <AssetsTab />
                </TabsContent>
                <TabsContent value="open-orders" className="h-full">
                  <PerpOpenOrdersTab
                    orders={filteredOpenOrders}
                    onCancelOrder={handleCancelOrder}
                    isPending={cancelPerpOrder.isPending}
                  />
                </TabsContent>
                <TabsContent value="order-history" className="h-full">
                  <PerpOrderHistoryTab orders={filteredOrderHistory} />
                </TabsContent>
                <TabsContent value="trade-history" className="h-full">
                  <TradeHistoryTab
                    trades={filteredTrades}
                    isAggregated={isAggregated}
                  />
                </TabsContent>
                <TabsContent value="funding-history" className="h-full">
                  <FundingHistoryTab sideFilter={sideFilter} />
                </TabsContent>
                <TabsContent value="deposits" className="h-full">
                  <DepositsTab
                    deposits={
                      depositsData?.pages.flatMap((p) => p.deposits) ?? []
                    }
                    hasNextPage={hasNextDeposits ?? false}
                    isFetchingNextPage={isFetchingNextDeposits}
                    fetchNextPage={fetchNextDeposits}
                  />
                </TabsContent>
                <TabsContent value="withdrawals" className="h-full">
                  <WithdrawalsTab
                    withdrawals={
                      withdrawalsData?.pages.flatMap((p) => p.withdrawals) ?? []
                    }
                    hasNextPage={hasNextWithdrawals ?? false}
                    isFetchingNextPage={isFetchingNextWithdrawals}
                    fetchNextPage={fetchNextWithdrawals}
                  />
                </TabsContent>
              </>
            )}
          </div>
          {/* Scroll fade indicator */}
          {showScrollFade && (
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
          )}
        </div>
      </Tabs>
    </div>
  )
}
