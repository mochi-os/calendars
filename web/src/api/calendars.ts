// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import type {
  CalendarResponse,
  CalendarsResponse,
  LinkResponse,
  PollResponse,
} from '@/api/types/calendars'

// The dialogs render their own failures, so the global toast would be a second
// copy of the same message.
const quiet = { mochi: { showGlobalErrorToast: false } } as const

const form = {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
} as const

const body = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString()

export const calendarsApi = {
  list: (): Promise<CalendarsResponse> =>
    requestHelpers.get<CalendarsResponse>(endpoints.calendars.list, quiet),

  get: (calendar: string): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.get,
      body({ calendar }),
      { ...form, ...quiet }
    ),

  create: (name: string, colour: string): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.create,
      body({ name, colour }),
      { ...form, ...quiet }
    ),

  rename: (calendar: string, name: string): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.rename,
      body({ calendar, name }),
      { ...form, ...quiet }
    ),

  colour: (calendar: string, colour: string): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.colour,
      body({ calendar, colour }),
      { ...form, ...quiet }
    ),

  delete: (calendar: string): Promise<Record<string, never>> =>
    requestHelpers.post<Record<string, never>>(
      endpoints.calendars.delete,
      body({ calendar }),
      { ...form, ...quiet }
    ),

  subscribe: (
    url: string,
    name: string,
    colour: string
  ): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.subscribe,
      body({ url, name, colour }),
      { ...form, ...quiet }
    ),

  poll: (calendar: string): Promise<PollResponse> =>
    requestHelpers.post<PollResponse>(
      endpoints.calendars.poll,
      body({ calendar }),
      { ...form, ...quiet }
    ),

  link: (calendar: string, regenerate = false): Promise<LinkResponse> =>
    requestHelpers.post<LinkResponse>(
      endpoints.link.get,
      body(regenerate ? { calendar, regenerate: '1' } : { calendar }),
      { ...form, ...quiet }
    ),

  linkRevoke: (calendar: string): Promise<Record<string, never>> =>
    requestHelpers.post<Record<string, never>>(
      endpoints.link.revoke,
      body({ calendar }),
      { ...form, ...quiet }
    ),
}
