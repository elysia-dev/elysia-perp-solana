"use client"

import { useSelectedPair } from "@/lib/stores"
import { useOrderbookRest } from "@/lib/hooks/useOrderbookRest"
import { OrderBookView } from "@/components/order-book"

export function DataCheckPanel() {
  const pair = useSelectedPair()
  const orderbook = useOrderbookRest(pair.id)

  return <OrderBookView data={orderbook.data} label="REST" />
}
