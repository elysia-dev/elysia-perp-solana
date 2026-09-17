"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { useAuthContext } from "@/lib/providers/AuthProvider"

export interface FundingPayment {
  id: number
  funding_id: number
  market_id: number
  market: string
  payment: string
  rate: string
  position_size: string
  position_side: string
  created_at: string
}

interface FundingPaymentsResponse {
  funding_payments: FundingPayment[]
}

export function useFundingHistory(market?: string) {
  const { isAuthenticated } = useAuthContext()

  const params = new URLSearchParams()
  params.set("limit", "50")
  if (market) params.set("market", market)

  return useQuery({
    queryKey: ["fundingHistory", market ?? "all"],
    queryFn: () =>
      apiClient<FundingPaymentsResponse>(
        `/perp/funding-payments?${params.toString()}`,
        { auth: true }
      ),
    enabled: isAuthenticated,
    staleTime: 10000,
  })
}
