import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import { TradesResponse } from "@/types"
import { useAuthContext } from "@/lib/providers/AuthProvider"

export function useTrades(aggregate = false) {
  const { isAuthenticated } = useAuthContext()

  const params = new URLSearchParams()
  if (aggregate) params.set("need_aggregate", "true")
  const query = params.toString()

  return useQuery({
    queryKey: ["trades", { aggregate }],
    queryFn: () =>
      apiClient<TradesResponse>(`/perp/trades${query ? `?${query}` : ""}`, {
        auth: true,
      }),
    enabled: isAuthenticated,
  })
}
