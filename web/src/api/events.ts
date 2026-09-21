// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import type {
  BoundsResponse,
  Component,
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

export const eventsApi = {
  /** Every occurrence in [start, finish), in unix seconds. */
  list: (
    start: number,
    finish: number,
    calendars?: string[]
  ): Promise<InstancesResponse> =>
    requestHelpers.get<InstancesResponse>(endpoints.events.list, {
      ...quiet,
      params: {
        start: String(start),
        finish: String(finish),
        ...(calendars && calendars.length
          ? { calendars: calendars.join(',') }
          : {}),
      },
    }),

  /** The first and last moments the calendars have anything on. */
  bounds: (calendars?: string[]): Promise<BoundsResponse> =>
    requestHelpers.get<BoundsResponse>(endpoints.events.bounds, {
      ...quiet,
      params:
        calendars && calendars.length
          ? { calendars: calendars.join(',') }
          : {},
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

  delete: (event: string, etag?: string): Promise<Record<string, never>> =>
    requestHelpers.post<Record<string, never>>(
      endpoints.events.delete,
      body(etag ? { event, etag } : { event }),
      { ...form, ...quiet }
    ),
}
