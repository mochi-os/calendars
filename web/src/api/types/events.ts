// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

/** One iCalendar property of a component: its name, parameters and value. */
export interface Property {
  name: string
  params: Record<string, string[]>
  value: string
}

/** A VEVENT (or a VALARM beneath one) as the server reads and writes it. */
export interface Component {
  name: string
  properties: Property[]
  components: Component[]
}

/** A stored event: its columns, its text and its parsed component tree. */
interface Event {
  id: string
  calendar: string
  slug: string
  uid: string
  etag: string
  component: string
  summary: string
  start: number
  finish: number
  allday: boolean
  recurring: boolean
  created: number
  updated: number
  ics: string
  components: Component[]
}

/** One occurrence in a listed range, recurrences already expanded. */
export interface Instance {
  /** The stored event, or `birthday-<contact>` for a derived birthday. */
  event: string
  calendar: string
  colour: string
  readonly: boolean
  uid: string
  component: string
  summary: string
  location: string
  description: string
  status: string
  start: number
  finish: number
  allday: boolean
  /** Present on all-day occurrences only, as YYYY-MM-DD. */
  date?: string
  recurring: boolean
  /** True when this occurrence is a RECURRENCE-ID override of its series. */
  exception?: boolean
  /**
   * The zone each end was written in, "" for a UTC or floating value; absent
   * on all-day occurrences.
   */
  zone?: { start: string; finish: string }
}

export interface InstancesResponse {
  instances: Instance[]
  truncated: boolean
}

/** Where the shown calendars' events begin and end, in unix seconds. */
export interface BoundsResponse {
  /** The earliest start, 0 when there is nothing. */
  first: number
  /** The last finish of anything that ends, 0 when nothing does. */
  last: number
  /** True when something repeats without end, so there is no last. */
  endless: boolean
}

export interface EventResponse {
  event: Event
}
