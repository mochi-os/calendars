// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { eventsApi, type CreateEvent, type UpdateEvent } from '@/api/events'
import type {
  BoundsResponse,
  EventResponse,
  Instance,
  InstancesResponse,
} from '@/api/types/events'

const eventKeys = {
  instances: (
    start: number,
    finish: number,
    calendars: string[],
    timezone = ''
  ) => ['instances', start, finish, calendars, timezone] as const,
  event: (event: string) => ['event', event] as const,
  bounds: (calendars: string[]) => ['bounds', calendars] as const,
}

/**
 * One query per visible range; every view renders from its answer. An empty
 * calendar list means "no filter" to the server, so with every calendar hidden
 * the query is not made at all rather than asking for all of them.
 */
export const useInstancesQuery = (
  start: number,
  finish: number,
  calendars: string[],
  timezone?: string
) => {
  // Sorted, so the same set of calendars is always the same cache entry.
  const key = [...calendars].sort()
  return useQuery<InstancesResponse>({
    queryKey: eventKeys.instances(start, finish, key, timezone),
    queryFn: () => eventsApi.list(start, finish, key, timezone),
    enabled: finish > start && key.length > 0,
    placeholderData: (previous) => previous,
  })
}

/**
 * The list view's pages, one range each, combined into a single sorted list.
 * The same keys as the range query, so a change to an event refreshes them
 * both.
 */
export const useInstancePages = (
  pages: { start: number; finish: number }[],
  calendars: string[],
  timezone?: string
) => {
  const key = [...calendars].sort()
  return useQueries({
    queries: pages.map((page) => ({
      queryKey: eventKeys.instances(page.start, page.finish, key, timezone),
      queryFn: () => eventsApi.list(page.start, page.finish, key, timezone),
      enabled: page.finish > page.start && key.length > 0,
    })),
    combine: (results) => ({
      instances: results
        .flatMap((result) => result.data?.instances ?? [])
        .sort((a: Instance, b: Instance) => a.start - b.start),
      pending: results.some((result) => result.isPending && result.fetchStatus !== 'idle'),
    }),
  })
}

/** Where the shown calendars' events begin and end. */
export const useBoundsQuery = (calendars: string[]) => {
  const key = [...calendars].sort()
  return useQuery<BoundsResponse>({
    queryKey: eventKeys.bounds(key),
    queryFn: () => eventsApi.bounds(key),
    enabled: key.length > 0,
  })
}

/** The stored event behind an occurrence, with its component tree. */
export const useEventQuery = (event: string | null) =>
  useQuery<EventResponse>({
    queryKey: eventKeys.event(event ?? ''),
    queryFn: () => eventsApi.get(event as string),
    enabled: Boolean(event) && !(event ?? '').startsWith('birthday-'),
  })

function useEventMutation<TVariables, TResult>(
  action: (variables: TVariables) => Promise<TResult>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      queryClient.invalidateQueries({ queryKey: ['event'] })
      queryClient.invalidateQueries({ queryKey: ['bounds'] })
    },
  })
}

export const useCreateEventMutation = () =>
  useEventMutation((event: CreateEvent) => eventsApi.create(event))

export const useUpdateEventMutation = () =>
  useEventMutation((event: UpdateEvent) => eventsApi.update(event))

export const useDeleteEventMutation = () =>
  useEventMutation(({ event, etag }: { event: string; etag?: string }) =>
    eventsApi.delete(event, etag)
  )
