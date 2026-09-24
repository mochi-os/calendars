// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

/** One calendar as `-/calendars` returns it. */
export interface Calendar {
  id: string
  fingerprint: string
  slug: string
  name: string
  colour: string
  kind: 'own' | 'subscription' | 'birthdays' | 'linked'
  /** The subscription's source address; empty for a calendar of one's own. */
  url: string
  /** The connected account a linked calendar syncs through; empty otherwise. */
  account: string
  /** The remote collection a linked calendar mirrors; empty otherwise. */
  collection: string
  readonly: boolean
  default: boolean
  version: number
  /** When the subscription was last fetched, unix seconds; 0 is never. */
  fetched: number
  /** The last poll failure, empty when the last poll succeeded. */
  failure: string
  created: number
  updated: number
}

export interface CalendarsResponse {
  calendars: Calendar[]
}

export interface CalendarResponse {
  calendar: Calendar
}

export interface PollResponse {
  changed: number
  calendar: Calendar
}

/** `-/link` answers with the token once, then only that one exists. */
export interface LinkResponse {
  token?: string
  path?: string
  exists?: boolean
}

/** A connected account that can hold a calendar. */
export interface CalendarAccount {
  id: string
  /** `google`, `apple` or `caldav`. */
  type: string
  label: string
  identifier: string
  /** The capabilities the account holds now, such as `login` and `calendar`. */
  granted: string[]
}

/** `-/calendars/account` answers the account it connected and tried. */
export interface AccountResponse {
  account: CalendarAccount
}

export interface AccountsResponse {
  accounts: CalendarAccount[]
  /** The OAuth provider types a new account can be granted from. */
  providers: string[]
  /** Whether the caller may set a missing provider up in the system settings. */
  administrator: boolean
}

/** One calendar an account's own server offers. */
export interface RemoteCalendar {
  /** The collection address to link. */
  href: string
  name: string
  description: string
  colour: string
  readonly: boolean
  /** The calendar here that already mirrors it, or empty. */
  linked: string
}

export interface RemoteResponse {
  calendars: RemoteCalendar[]
}

/** `-/calendars/grant` answers the address the browser visits to consent. */
export interface GrantResponse {
  url: string
}
