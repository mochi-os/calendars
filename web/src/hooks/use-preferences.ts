// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { preferencesApi } from '@/api/preferences'
import type {
  Preferences,
  PreferencesResponse,
} from '@/api/types/preferences'

const preferenceKeys = {
  all: () => ['preferences'] as const,
}

/** The defaults the server applies, so a view can render before the answer. */
export const DEFAULTS: Preferences = {
  hours: { start: 8, finish: 17 },
  days: [1, 2, 3, 4, 5],
  multiweek: { weeks: 4, previous: 0 },
  duration: 60,
  reminder: 15,
  view: 'month',
}

export const usePreferencesQuery = () =>
  useQuery<PreferencesResponse>({
    queryKey: preferenceKeys.all(),
    queryFn: () => preferencesApi.get(),
  })

export const useSetPreferencesMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: Partial<Preferences>) => preferencesApi.set(values),
    onSuccess: (answer) => {
      queryClient.setQueryData(preferenceKeys.all(), answer)
    },
  })
}
