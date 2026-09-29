// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calendarsApi } from '@/api/calendars'
import type {
  AccountsResponse,
  CalendarsResponse,
  RemoteResponse,
} from '@/api/types/calendars'

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
  useCalendarMutation(
    ({ calendar, name }: { calendar: string; name: string }) =>
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

/**
 * Linked calendars sync every five minutes. Asking the server to sync them as
 * the app opens, and whenever it comes back into view, brings another
 * server's changes in moments after the user looks; the server leaves alone
 * any synced in the last minute.
 */
export const useCalendarsRefresh = () => {
  const queryClient = useQueryClient()
  return useQuery({
    // Not under 'calendars': invalidating those would run it again.
    queryKey: ['refresh'],
    queryFn: async () => {
      const result = await calendarsApi.refresh()
      if (result.changed) {
        queryClient.invalidateQueries({ queryKey: calendarKeys.all() })
        queryClient.invalidateQueries({ queryKey: ['calendar'] })
        queryClient.invalidateQueries({ queryKey: ['instances'] })
        queryClient.invalidateQueries({ queryKey: ['bounds'] })
      }
      return result
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

export const usePollCalendarMutation = () =>
  useCalendarMutation((calendar: string) => calendarsApi.poll(calendar))

/** The connected accounts a calendar can be linked through. */
export const useCalendarAccountsQuery = (enabled: boolean) =>
  useQuery<AccountsResponse>({
    queryKey: ['calendars', 'accounts'],
    queryFn: () => calendarsApi.accounts(),
    enabled,
  })

/** Connects an Apple or CalDAV account the wizard can then link through. */
export const useAddCalendarAccountMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fields: {
      type: 'apple' | 'caldav'
      url?: string
      username: string
      password: string
      label?: string
    }) => calendarsApi.account(fields),
    // The variables carry the account's password: once the wizard lets go of
    // them, the cache drops them too.
    gcTime: 0,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars', 'accounts'] })
    },
  })
}

/** The calendars an account's own server offers. */
export const useRemoteCalendarsQuery = (account: string | null) =>
  useQuery<RemoteResponse>({
    queryKey: ['calendars', 'remote', account],
    queryFn: () => calendarsApi.remote(account ?? ''),
    enabled: account !== null && account !== '',
  })

export const useLinkCalendarMutation = () =>
  useCalendarMutation(
    (fields: {
      account: string
      collection: string
      name: string
      colour: string
    }) => calendarsApi.link(fields)
  )

export const useGrantCalendarMutation = () =>
  useMutation({
    mutationFn: (fields: {
      target: string
      account?: string
      provider?: string
    }) => calendarsApi.grant(fields),
  })
