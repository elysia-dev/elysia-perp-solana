import { create } from "zustand"
import type { PerpOrder } from "@/types"

interface OpenOrdersState {
  orders: PerpOrder[]
  setOrders: (orders: PerpOrder[]) => void
  removeOrder: (orderId: number) => void
}

export const useOpenOrdersStore = create<OpenOrdersState>((set, get) => ({
  orders: [],
  setOrders: (orders) =>
    set({ orders: [...orders].sort((a, b) => b.id - a.id) }),
  removeOrder: (orderId) => {
    set({ orders: get().orders.filter((o) => o.id !== orderId) })
  },
}))
