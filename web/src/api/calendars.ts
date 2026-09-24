// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import type {
  AccountResponse,
  AccountsResponse,
  CalendarResponse,
  CalendarsResponse,
  GrantResponse,
  LinkResponse,
  PollResponse,
  RemoteResponse,
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

  // The connected accounts a calendar can be linked through, and the OAuth
  // providers a new one can be granted from.
  accounts: (): Promise<AccountsResponse> =>
    requestHelpers.get<AccountsResponse>(endpoints.calendars.accounts, quiet),

  // Start the consent that grants calendar access, to a known account or to a
  // new one of the provider. The browser visits the answer at the top window.
  grant: (fields: {
    target: string
    account?: string
    provider?: string
  }): Promise<GrantResponse> =>
    requestHelpers.post<GrantResponse>(
      endpoints.calendars.grant,
      body({
        target: fields.target,
        account: fields.account ?? '',
        provider: fields.provider ?? '',
      }),
      { ...form, ...quiet }
    ),

  // Connect an Apple or CalDAV account and try it against its server; a
  // credential the server refuses is not kept.
  account: (fields: {
    type: 'apple' | 'caldav'
    url?: string
    username: string
    password: string
    label?: string
  }): Promise<AccountResponse> =>
    requestHelpers.post<AccountResponse>(
      endpoints.calendars.account,
      body({
        type: fields.type,
        url: fields.url ?? '',
        username: fields.username,
        password: fields.password,
        label: fields.label ?? '',
      }),
      { ...form, ...quiet }
    ),

  remote: (account: string): Promise<RemoteResponse> =>
    requestHelpers.post<RemoteResponse>(
      endpoints.calendars.remote,
      body({ account }),
      { ...form, ...quiet }
    ),

  link: (fields: {
    account: string
    collection: string
    name: string
    colour: string
  }): Promise<CalendarResponse> =>
    requestHelpers.post<CalendarResponse>(
      endpoints.calendars.link,
      body(fields),
      { ...form, ...quiet }
    ),

  // The address others subscribe to, issued once. Not the linked-calendar
  // link above.
  address: (calendar: string, regenerate = false): Promise<LinkResponse> =>
    requestHelpers.post<LinkResponse>(
      endpoints.link.get,
      body(regenerate ? { calendar, regenerate: '1' } : { calendar }),
      { ...form, ...quiet }
    ),

  addressRevoke: (calendar: string): Promise<Record<string, never>> =>
    requestHelpers.post<Record<string, never>>(
      endpoints.link.revoke,
      body({ calendar }),
      { ...form, ...quiet }
    ),
}
