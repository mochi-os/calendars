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
import { calendarsApi } from '@/api/calendars'
import {
  eventsApi,
  type CreateEvent,
  type SplitEvent,
  type UpdateEvent,
} from '@/api/events'
import type {
  BoundsResponse,
  Event,
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
    combine: (results) => {
      // An occurrence that crosses from one page into the next comes back
      // with both, and is listed once.
      const seen = new Set<string>()
      const instances = results
        .flatMap((result) => result.data?.instances ?? [])
        .filter((instance) => {
          const key = `${instance.event}:${instance.start}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a: Instance, b: Instance) => a.start - b.start)
      return {
        instances,
        pending: results.some(
          (result) => result.isPending && result.fetchStatus !== 'idle'
        ),
        failed: results.some((result) => result.isError),
        retry: () => {
          for (const result of results) {
            if (result.isError) void result.refetch()
          }
        },
      }
    },
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

/**
 * A mutation over events, refreshing the instances, the events and the bounds
 * when it lands. A deletion names the event it removed, which is left out of
 * the refresh: the dialog that deleted it still holds its query while it
 * closes, and refreshing that would fetch the event again and be answered 404.
 */
function useEventMutation<TVariables, TResult>(
  action: (variables: TVariables) => Promise<TResult>,
  deleted?: (variables: TVariables) => string
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: (_, variables) => {
      const removed = deleted?.(variables)
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      queryClient.invalidateQueries({
        queryKey: ['event'],
        predicate: (query) => query.queryKey[1] !== removed,
      })
      queryClient.invalidateQueries({ queryKey: ['bounds'] })
    },
  })
}

// The events a write answers with, put in their queries as they arrive, so an
// editor following one shows it at once rather than the copy from before.
function useWritten() {
  const queryClient = useQueryClient()
  return (...events: Event[]) => {
    for (const event of events) {
      queryClient.setQueryData<EventResponse>(eventKeys.event(event.id), {
        event,
      })
    }
  }
}

export const useCreateEventMutation = () => {
  const written = useWritten()
  return useEventMutation((event: CreateEvent) =>
    eventsApi.create(event).then((result) => {
      written(result.event)
      return result
    })
  )
}

export const useUpdateEventMutation = () => {
  const written = useWritten()
  return useEventMutation((event: UpdateEvent) =>
    eventsApi.update(event).then((result) => {
      written(result.event)
      return result
    })
  )
}

export const useSplitEventMutation = () => {
  const written = useWritten()
  return useEventMutation((event: SplitEvent) =>
    eventsApi.split(event).then((result) => {
      written(result.event, result.following)
      return result
    })
  )
}

export const useDeleteEventMutation = () =>
  useEventMutation(
    ({ event, etag }: { event: string; etag?: string }) =>
      eventsApi.delete(event, etag),
    ({ event }) => event
  )

/** What a whole import wrote, summed over its rounds. */
export interface ImportTotals {
  imported: number
  skipped: number
  failed: number
}

/**
 * Imports an iCalendar file into a calendar. Each request writes only part of
 * a long file, so the rounds repeat with the staged file and the offset the
 * last one reached until the server says it is finished; `progress` hears how
 * far each round got. The events are refreshed however it ends, a failure
 * part-way included, since the rounds before it wrote theirs.
 */
export const useImportEventsMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      calendar,
      file,
      progress,
    }: {
      calendar: string
      file: File
      progress: (done: number, total: number) => void
    }): Promise<ImportTotals> => {
      const totals = { imported: 0, skipped: 0, failed: 0 }
      let round = await calendarsApi.import({ calendar, offset: 0, file })
      for (;;) {
        totals.imported += round.imported
        totals.skipped += round.skipped
        totals.failed += round.failed
        progress(round.offset, round.total)
        if (round.finished) return totals
        round = await calendarsApi.import({
          calendar,
          offset: round.offset,
          staged: round.import,
        })
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      queryClient.invalidateQueries({ queryKey: ['event'] })
      queryClient.invalidateQueries({ queryKey: ['bounds'] })
    },
  })
}
