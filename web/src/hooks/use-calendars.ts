// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calendarsApi } from '@/api/calendars'
import type { CalendarsResponse } from '@/api/types/calendars'

const calendarKeys = {
  all: () => ['calendars'] as const,
}

export const useCalendarsQuery = () =>
  useQuery<CalendarsResponse>({
    queryKey: calendarKeys.all(),
    queryFn: () => calendarsApi.list(),
  })

function useCalendarMutation<TVariables, TResult>(
  action: (variables: TVariables) => Promise<TResult>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.all() })
      // A calendar's own page reads it under its fingerprint.
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      queryClient.invalidateQueries({ queryKey: ['bounds'] })
    },
  })
}

export const useCreateCalendarMutation = () =>
  useCalendarMutation(({ name, colour }: { name: string; colour: string }) =>
    calendarsApi.create(name, colour)
  )

export const useRenameCalendarMutation = () =>
  useCalendarMutation(({ calendar, name }: { calendar: string; name: string }) =>
    calendarsApi.rename(calendar, name)
  )

export const useColourCalendarMutation = () =>
  useCalendarMutation(
    ({ calendar, colour }: { calendar: string; colour: string }) =>
      calendarsApi.colour(calendar, colour)
  )

export const useDeleteCalendarMutation = () =>
  useCalendarMutation((calendar: string) => calendarsApi.delete(calendar))

export const useSubscribeCalendarMutation = () =>
  useCalendarMutation(
    ({ url, name, colour }: { url: string; name: string; colour: string }) =>
      calendarsApi.subscribe(url, name, colour)
  )

export const usePollCalendarMutation = () =>
  useCalendarMutation((calendar: string) => calendarsApi.poll(calendar))
