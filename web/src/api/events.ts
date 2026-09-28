// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import type {
  BoundsResponse,
  Component,
  Event,
  EventResponse,
  InstancesResponse,
} from '@/api/types/events'

const quiet = { mochi: { showGlobalErrorToast: false } } as const

const form = {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
} as const

const body = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString()

export interface CreateEvent {
  calendar?: string
  components: Component[]
}

export interface UpdateEvent {
  event: string
  etag?: string
  calendar?: string
  components?: Component[]
}

/**
 * A series cut in two at an occurrence: the old event rewritten to end
 * before it, and a new event carrying the series from there on.
 */
export interface SplitEvent {
  event: string
  etag?: string
  /** The occurrence the cut falls on, in unix seconds. */
  start: number
  /** The old event's components, ending before the occurrence. */
  components: Component[]
  /** The new event's components, the series from the occurrence on. */
  following: Component[]
  /** The calendar the new event goes in; the old event's by default. */
  calendar?: string
  /** Leaves the old event as it is: the new one is a copy from there on. */
  copy?: boolean
}

export interface SplitResponse {
  event: Event
  following: Event
}

export const eventsApi = {
  /** Every occurrence in [start, finish), in unix seconds. */
  list: (
    start: number,
    finish: number,
    calendars?: string[],
    timezone?: string
  ): Promise<InstancesResponse> =>
    requestHelpers.get<InstancesResponse>(endpoints.events.list, {
      ...quiet,
      params: {
        start: String(start),
        finish: String(finish),
        ...(calendars && calendars.length
          ? { calendars: calendars.join(',') }
          : {}),
        // The zone "auto" resolved to here, so the server expands floating
        // times and day boundaries in the zone the views draw in.
        ...(timezone ? { timezone } : {}),
      },
    }),

  /** The first and last moments the calendars have anything on. */
  bounds: (calendars?: string[]): Promise<BoundsResponse> =>
    requestHelpers.get<BoundsResponse>(endpoints.events.bounds, {
      ...quiet,
      params:
        calendars && calendars.length ? { calendars: calendars.join(',') } : {},
    }),

  get: (event: string): Promise<EventResponse> =>
    requestHelpers.post<EventResponse>(endpoints.events.get, body({ event }), {
      ...form,
      ...quiet,
    }),

  create: (event: CreateEvent): Promise<EventResponse> =>
    requestHelpers.post<EventResponse>(endpoints.events.create, event, quiet),

  update: (event: UpdateEvent): Promise<EventResponse> =>
    requestHelpers.post<EventResponse>(endpoints.events.update, event, quiet),

  split: (event: SplitEvent): Promise<SplitResponse> =>
    requestHelpers.post<SplitResponse>(endpoints.events.split, event, quiet),

  delete: (event: string, etag?: string): Promise<Record<string, never>> =>
    requestHelpers.post<Record<string, never>>(
      endpoints.events.delete,
      body(etag ? { event, etag } : { event }),
      { ...form, ...quiet }
    ),
}
