"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api/client"

interface InsuranceLoginResponse {
  user_id: number
  role: string
  access_expires_in: number
  refresh_expires_in: number
}

export function useInsuranceLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (password: string) =>
      apiClient<InsuranceLoginResponse>("/auth/admin/insurance-login", {
        method: "POST",
        body: { password },
        auth: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account"] })
    },
  })
}
