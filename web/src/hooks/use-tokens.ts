// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tokensApi } from '@/api/tokens'
import type { GetTokensResponse } from '@/api/types/tokens'

const tokenKeys = {
  all: () => ['tokens'] as const,
}

export const useTokensQuery = (enabled: boolean) =>
  useQuery<GetTokensResponse>({
    queryKey: tokenKeys.all(),
    queryFn: () => tokensApi.list(),
    enabled,
  })

export const useCreateTokenMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => tokensApi.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokenKeys.all() })
    },
  })
}

export const useDeleteTokenMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (hash: string) => tokensApi.delete(hash),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tokenKeys.all() })
    },
  })
}
