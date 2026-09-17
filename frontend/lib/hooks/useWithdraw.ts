"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"

interface WithdrawRequest {
  asset_id: number // 출금할 토큰 (멀티토큰, ELP-133)
  amount: string // 사람이 읽는 숫자 (예: "100.5")
  // Solana 자산(예: MEME 9004)은 destination(연결된 Solana 지갑, base58)이
  // 필수 — 서버가 이 계정에 linked된 credential인지 검증. EVM 자산엔 넣으면 거부.
  destination?: string
}

interface WithdrawResponse {
  id: number
  address: string
  asset_id: number
  amount: string
  route_type: string
  new_balance: string
}

export function useWithdraw() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ asset_id, amount, destination }: WithdrawRequest) => {
      return apiClient<WithdrawResponse>("/account/withdraw", {
        method: "POST",
        auth: true,
        body: {
          asset_id,
          amount,
          route_type: "perp",
          ...(destination ? { destination } : {}),
        },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["account"],
      })
      queryClient.invalidateQueries({
        queryKey: ["withdrawal-history"],
      })
    },
  })
}
