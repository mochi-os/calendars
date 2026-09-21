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
  kind: 'own' | 'subscription' | 'birthdays'
  /** The subscription's source address; empty for a calendar of one's own. */
  url: string
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
