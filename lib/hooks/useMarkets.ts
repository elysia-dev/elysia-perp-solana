import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"
import type { Market } from "@/types"

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => apiClient<Market[]>("/markets"),
  })
}
