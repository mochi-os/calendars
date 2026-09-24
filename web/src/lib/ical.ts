// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
/* eslint-disable lingui/no-unlocalized-strings -- every literal here is an
   iCalendar protocol token, never shown to anyone. */
// The editor's own model of an event and the iCalendar component tree the
// server stores. Everything here is pure: a day is YYYY-MM-DD as it reads in
// the named zone, a time is minutes since midnight, and instants are unix
// seconds.
import { addDays, timestampAt, zonedDay, zonedMinutes } from '@mochi/web'
import type { Component, Property } from '@/api/types/events'

export type Frequency = 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly'
type Ending = 'never' | 'until' | 'count'

export interface Repeat {
  frequency: Frequency
  /** Every n days, weeks, months or years. */
  interval: number
  /** Weekly only: 0 = Sunday through 6 = Saturday. */
  weekdays: number[]
  ending: Ending
  /** The last day the series may fall on, when ending is "until". */
  until: string
  /** How many occurrences, when ending is "count". */
  count: number
  /**
   * The RRULE as it was read, written back as it is for as long as the
   * settings above are untouched, so a rule the editor cannot express, such
   * as the second Tuesday of every month, survives a title change or a move.
   * "" once the settings change, or for an event that does not repeat.
   */
  rule: string
}

export interface EventDraft {
  title: string
  calendar: string
  allday: boolean
  start: string
  /** Minutes since midnight; ignored for an all-day event. */
  startTime: number
  /** The last day of an all-day event, or the day the event ends on. */
  finish: string
  finishTime: number
  /**
   * The zone each end's clock reads in. A flight is 10:00 Europe/London to
   * 13:00 America/New_York; most events have the same zone at both ends.
   */
  zone: { start: string; finish: string }
  location: string
  description: string
  repeat: Repeat
  /** Minutes before the start; -1 is no reminder. */
  reminder: number
}

export const NO_REMINDER = -1

export function emptyRepeat(): Repeat {
  return {
    frequency: 'never',
    interval: 1,
    weekdays: [],
    ending: 'never',
    until: '',
    count: 10,
    rule: '',
  }
}

// Properties the editor owns; anything else on an edited event is carried
// through untouched, so a property a phone wrote survives a web edit.
const MANAGED = new Set([
  'SUMMARY',
  'DTSTART',
  'DTEND',
  'DURATION',
  'LOCATION',
  'DESCRIPTION',
  'RRULE',
  'UID',
  'DTSTAMP',
])

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// --- Reading and writing property values ---

export function property(
  component: Component,
  name: string
): Property | undefined {
  return component.properties.find((item) => item.name === name)
}

export function propertyValue(component: Component, name: string): string {
  return property(component, name)?.value ?? ''
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** A DATE value: 20260916. */
function dateValue(day: string): string {
  return day.replace(/-/g, '')
}

/** A local DATE-TIME value: 20260916T090000. */
function dateTimeValue(day: string, minutes: number): string {
  const hour = Math.floor(minutes / 60)
  return `${dateValue(day)}T${pad(hour)}${pad(minutes % 60)}00`
}

/** A UTC DATE-TIME value: 20260916T080000Z. */
export function utcValue(seconds: number): string {
  const date = new Date(seconds * 1000)
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/**
 * The instant a DTSTART-style property names, in unix seconds, and whether it
 * is a whole-day value. A floating time is read in `timezone`, as the server
 * reads it.
 */
export function propertyInstant(
  item: Property | undefined,
  timezone: string
): { seconds: number; allday: boolean; zone: string } | null {
  if (!item || !item.value) return null
  const value = item.value.trim()
  const zone = item.params?.TZID?.[0] ?? ''
  if (/^\d{8}$/.test(value)) {
    const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    return { seconds: timestampAt(day, 0, timezone), allday: true, zone }
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, utc] = match
  if (utc === 'Z') {
    return {
      seconds:
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second)
        ) / 1000,
      allday: false,
      zone: '',
    }
  }
  return {
    seconds: timestampAt(
      `${year}-${month}-${day}`,
      Number(hour) * 60 + Number(minute),
      zone || timezone
    ),
    allday: false,
    zone,
  }
}

// --- Repeat ---

/** The parts of a rule the editor's settings can hold. */
const PLAIN = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT'])

/**
 * True when the editor's settings can say everything a rule says: a plain
 * frequency, an interval, weekdays on a weekly rule, and an end by date or
 * count. A rule with more, a BYMONTHDAY, a BYSETPOS, an ordinal weekday, is
 * shown as custom and kept as written.
 */
export function expressible(rule: string): boolean {
  if (!rule) return true
  const fields = new Map<string, string>()
  for (const part of rule.split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) return false
    fields.set(
      part.slice(0, at).trim().toUpperCase(),
      part.slice(at + 1).trim()
    )
  }
  for (const key of fields.keys()) if (!PLAIN.has(key)) return false
  const frequency = (fields.get('FREQ') ?? '').toUpperCase()
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency))
    return false
  if (fields.has('UNTIL') && fields.has('COUNT')) return false
  const byday = fields.get('BYDAY')
  if (byday !== undefined) {
    if (frequency !== 'WEEKLY') return false
    for (const token of byday.split(',')) {
      if (!WEEKDAYS.includes(token.trim().toUpperCase())) return false
    }
  }
  return true
}

/**
 * An RRULE value from the editor's repeat settings: the rule as it was read
 * while the settings are untouched, else one built from them.
 */
export function repeatRule(repeat: Repeat, timezone: string): string {
  if (repeat.rule) return repeat.rule
  if (repeat.frequency === 'never') return ''
  const parts = [`FREQ=${repeat.frequency.toUpperCase()}`]
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`)
  if (repeat.frequency === 'weekly' && repeat.weekdays.length) {
    const days = [...repeat.weekdays]
      .sort((a, b) => a - b)
      .map((day) => WEEKDAYS[day])
    parts.push(`BYDAY=${days.join(',')}`)
  }
  if (repeat.ending === 'until' && repeat.until) {
    // The last moment of the chosen day, so the day itself is included.
    parts.push(
      `UNTIL=${utcValue(timestampAt(repeat.until, 1440, timezone) - 1)}`
    )
  } else if (repeat.ending === 'count') {
    parts.push(`COUNT=${Math.max(1, repeat.count)}`)
  }
  return parts.join(';')
}

/** The editor's repeat settings from an RRULE value. */
export function ruleRepeat(rule: string, timezone: string): Repeat {
  const out = emptyRepeat()
  if (!rule.trim()) return out
  out.rule = rule.trim()
  const fields = new Map<string, string>()
  for (const part of rule.split(';')) {
    const at = part.indexOf('=')
    if (at > 0) fields.set(part.slice(0, at).toUpperCase(), part.slice(at + 1))
  }
  const frequency = (fields.get('FREQ') ?? '').toLowerCase()
  if (
    frequency === 'daily' ||
    frequency === 'weekly' ||
    frequency === 'monthly' ||
    frequency === 'yearly'
  ) {
    out.frequency = frequency
  }
  const interval = Number(fields.get('INTERVAL') ?? '1')
  if (Number.isFinite(interval) && interval > 0) out.interval = interval
  const byday = fields.get('BYDAY')
  if (byday) {
    out.weekdays = byday
      .split(',')
      .map((token) => WEEKDAYS.indexOf(token.trim().slice(-2).toUpperCase()))
      .filter((day) => day >= 0)
  }
  const until = fields.get('UNTIL')
  if (until) {
    const instant = propertyInstant(
      { name: 'UNTIL', params: {}, value: until },
      timezone
    )
    if (instant) {
      out.ending = 'until'
      out.until = zonedDay(new Date(instant.seconds * 1000), timezone)
    }
  } else if (fields.get('COUNT')) {
    const count = Number(fields.get('COUNT'))
    if (Number.isFinite(count) && count > 0) {
      out.ending = 'count'
      out.count = count
    }
  }
  return out
}

// --- Reminders ---

/** A TRIGGER duration for a reminder that many minutes before the start. */
export function reminderTrigger(minutes: number): string {
  if (minutes <= 0) return 'PT0M'
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`
  return `-PT${minutes}M`
}

/** The minutes before the start a TRIGGER names; null when it is not one. */
export function triggerMinutes(trigger: string): number | null {
  const match =
    /^(-?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      trigger.trim().toUpperCase()
    )
  if (!match) return null
  const [, sign, weeks, days, hours, minutes, seconds] = match
  const total =
    Number(weeks ?? 0) * 10080 +
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60
  if (total === 0) return 0
  return sign === '-' ? total : -total
}

function alarm(minutes: number, summary: string): Component {
  return {
    name: 'VALARM',
    properties: [
      { name: 'ACTION', params: {}, value: 'DISPLAY' },
      { name: 'DESCRIPTION', params: {}, value: summary },
      { name: 'TRIGGER', params: {}, value: reminderTrigger(minutes) },
    ],
    components: [],
  }
}

/**
 * Whether a draft's zones are worth showing: a timed event with an end that is
 * not in the user's zone. Both ends in the user's zone, or an event that had
 * no zone at all and so reads in the user's, say nothing the user needs to see.
 */
export function foreignZones(draft: EventDraft, timezone: string): boolean {
  return (
    !draft.allday &&
    (draft.zone.start !== timezone || draft.zone.finish !== timezone)
  )
}

/** The instants a timed draft's two ends name, each read in its own zone. */
export function draftInstants(draft: EventDraft): {
  start: number
  finish: number
} {
  if (draft.allday) {
    return {
      start: timestampAt(draft.start, 0, draft.zone.start),
      finish: timestampAt(addDays(draft.finish, 1), 0, draft.zone.finish),
    }
  }
  return {
    start: timestampAt(draft.start, draft.startTime, draft.zone.start),
    finish: timestampAt(draft.finish, draft.finishTime, draft.zone.finish),
  }
}

// --- Draft to components ---

function startProperty(draft: EventDraft): Property {
  if (draft.allday) {
    return {
      name: 'DTSTART',
      params: { VALUE: ['DATE'] },
      value: dateValue(draft.start),
    }
  }
  return {
    name: 'DTSTART',
    params: { TZID: [draft.zone.start] },
    value: dateTimeValue(draft.start, draft.startTime),
  }
}

function finishProperty(draft: EventDraft): Property {
  if (draft.allday) {
    // DTEND is exclusive, so a one-day event ends on the following day.
    return {
      name: 'DTEND',
      params: { VALUE: ['DATE'] },
      value: dateValue(addDays(draft.finish, 1)),
    }
  }
  return {
    name: 'DTEND',
    params: { TZID: [draft.zone.finish] },
    value: dateTimeValue(draft.finish, draft.finishTime),
  }
}

/**
 * The VEVENT an editor draft describes. Properties the editor does not own are
 * carried over from `previous`, as are that component's own sub-components
 * other than its alarms, which the reminder setting replaces.
 */
export function draftComponent(
  draft: EventDraft,
  previous?: Component
): Component {
  const kept = (previous?.properties ?? []).filter(
    (item) => !MANAGED.has(item.name)
  )
  const properties: Property[] = [
    { name: 'SUMMARY', params: {}, value: draft.title },
    startProperty(draft),
    finishProperty(draft),
  ]
  if (draft.location) {
    properties.push({ name: 'LOCATION', params: {}, value: draft.location })
  }
  if (draft.description) {
    properties.push({
      name: 'DESCRIPTION',
      params: {},
      value: draft.description,
    })
  }
  const rule = repeatRule(draft.repeat, draft.zone.start)
  if (rule) properties.push({ name: 'RRULE', params: {}, value: rule })

  const components = (previous?.components ?? []).filter(
    (item) => item.name !== 'VALARM'
  )
  if (draft.reminder !== NO_REMINDER) {
    components.push(alarm(draft.reminder, draft.title))
  }
  return {
    name: 'VEVENT',
    properties: [...properties, ...kept],
    components,
  }
}

/** The editor's draft for an existing VEVENT. */
export function componentDraft(
  component: Component,
  calendar: string,
  timezone: string
): EventDraft {
  const start = propertyInstant(property(component, 'DTSTART'), timezone)
  const finish = propertyInstant(property(component, 'DTEND'), timezone)
  // Each end's own zone; an end without one, UTC or floating, is edited in
  // the user's zone, and a DTEND without one follows the start.
  const zone = property(component, 'DTSTART')?.params?.TZID?.[0] ?? timezone
  const finishZone = property(component, 'DTEND')?.params?.TZID?.[0] ?? zone
  const allday = start?.allday ?? false
  const startSeconds = start?.seconds ?? Math.floor(Date.now() / 1000)
  // A whole-day DTEND is the day after the last, and an event with neither
  // DTEND nor DURATION ends where it starts.
  const finishSeconds = finish
    ? allday
      ? finish.seconds - 1
      : finish.seconds
    : startSeconds

  const reminderAlarm = component.components.find(
    (item) => item.name === 'VALARM'
  )
  const trigger = reminderAlarm
    ? triggerMinutes(propertyValue(reminderAlarm, 'TRIGGER'))
    : null

  return {
    title: propertyValue(component, 'SUMMARY'),
    calendar,
    allday,
    start: zonedDay(new Date(startSeconds * 1000), zone),
    startTime: zonedMinutes(new Date(startSeconds * 1000), zone),
    finish: zonedDay(new Date(finishSeconds * 1000), finishZone),
    finishTime: zonedMinutes(new Date(finishSeconds * 1000), finishZone),
    zone: { start: zone, finish: finishZone },
    location: propertyValue(component, 'LOCATION'),
    description: propertyValue(component, 'DESCRIPTION'),
    repeat: ruleRepeat(propertyValue(component, 'RRULE'), zone),
    reminder: trigger === null ? NO_REMINDER : trigger,
  }
}

/** The master VEVENT of a stored event: the one with no RECURRENCE-ID. */
export function masterComponent(
  components: Component[]
): Component | undefined {
  return (
    components.find(
      (item) => item.name === 'VEVENT' && !property(item, 'RECURRENCE-ID')
    ) ?? components.find((item) => item.name === 'VEVENT')
  )
}

/** The override of one occurrence, if the event already carries one. */
export function overrideComponent(
  components: Component[],
  start: number,
  timezone: string
): Component | undefined {
  return components.find((item) => {
    if (item.name !== 'VEVENT') return false
    const id = property(item, 'RECURRENCE-ID')
    if (!id) return false
    const instant = propertyInstant(id, timezone)
    return instant !== null && instant.seconds === start
  })
}

/**
 * A RECURRENCE-ID naming the occurrence that starts at `start`, in the form
 * the master's own DTSTART uses so the two describe the same instant.
 */
function recurrenceIdentifier(
  master: Component,
  start: number,
  timezone: string
): Property {
  const dtstart = property(master, 'DTSTART')
  const zone = dtstart?.params?.TZID?.[0] ?? ''
  if (dtstart && /^\d{8}$/.test(dtstart.value)) {
    return {
      name: 'RECURRENCE-ID',
      params: { VALUE: ['DATE'] },
      value: dateValue(zonedDay(new Date(start * 1000), zone || timezone)),
    }
  }
  if (zone) {
    return {
      name: 'RECURRENCE-ID',
      params: { TZID: [zone] },
      value: dateTimeValue(
        zonedDay(new Date(start * 1000), zone),
        zonedMinutes(new Date(start * 1000), zone)
      ),
    }
  }
  return { name: 'RECURRENCE-ID', params: {}, value: utcValue(start) }
}

/**
 * The master with `start` added to its EXDATE, which removes that one
 * occurrence from the series.
 */
function withException(
  master: Component,
  start: number,
  timezone: string
): Component {
  const identifier = recurrenceIdentifier(master, start, timezone)
  const properties = [...master.properties]
  const existing = properties.findIndex((item) => item.name === 'EXDATE')
  if (existing >= 0) {
    const current = properties[existing]
    properties[existing] = {
      ...current,
      value: current.value
        ? `${current.value},${identifier.value}`
        : identifier.value,
    }
  } else {
    properties.push({
      name: 'EXDATE',
      params: identifier.params,
      value: identifier.value,
    })
  }
  return { ...master, properties }
}

/**
 * Which occurrences an edit lands on: this one, the whole series, or this
 * one and every one after it.
 */
export type Scope = 'one' | 'all' | 'following'

/**
 * The component list to send for an edit. "All events" rewrites the master and
 * keeps any overrides; "This event" leaves the master alone and writes an
 * override for the one occurrence, replacing an earlier override of it.
 */
export function editedComponents(
  components: Component[],
  draft: EventDraft,
  scope: Scope,
  start: number,
  timezone: string
): Component[] {
  const master = masterComponent(components)
  if (!master) return [draftComponent(draft)]
  if (scope === 'all') {
    const rewritten = draftComponent(draft, master)
    // A series that moved takes its overrides and listed dates along.
    const first = masterStart(master, timezone)
    const shift = first === null ? 0 : draftInstants(draft).start - first
    if (shift === 0) {
      return [rewritten, ...components.filter((item) => item !== master)]
    }
    const { after: dates } = cutDates(
      master.properties,
      -Infinity,
      shift,
      timezone
    )
    const head: Component = {
      ...rewritten,
      properties: [
        ...rewritten.properties.filter(
          (item) => item.name !== 'RDATE' && item.name !== 'EXDATE'
        ),
        ...dates.filter(
          (item) => item.name === 'RDATE' || item.name === 'EXDATE'
        ),
      ],
    }
    return [
      head,
      ...components.filter((item) => item !== master && item.name !== 'VEVENT'),
      ...carriedOverrides(
        components,
        master,
        head,
        -Infinity,
        shift,
        draft.calendar,
        timezone
      ),
    ]
  }
  const existing = overrideComponent(components, start, timezone)
  // An override carries no rule of its own: it describes one occurrence.
  const single = draftComponent(
    { ...draft, repeat: emptyRepeat() },
    existing ?? master
  )
  const identifier = recurrenceIdentifier(master, start, timezone)
  // An override describes one occurrence: the series' own rule and the dates
  // it adds or excludes belong to the master alone.
  const series = new Set(['RECURRENCE-ID', 'RRULE', 'RDATE', 'EXDATE'])
  const override: Component = {
    ...single,
    properties: [
      ...single.properties.filter((item) => !series.has(item.name)),
      identifier,
    ],
  }
  const rest = components.filter((item) => item !== existing)
  return [...rest, override]
}

/**
 * The component list to send when one occurrence of a series is deleted: the
 * master gains an exception for it and any override of it is dropped.
 */
export function deletedOccurrence(
  components: Component[],
  start: number,
  timezone: string
): Component[] | null {
  const master = masterComponent(components)
  if (!master) return null
  const existing = overrideComponent(components, start, timezone)
  return components
    .filter((item) => item !== existing)
    .map((item) =>
      item === master ? withException(item, start, timezone) : item
    )
}

// --- Splitting a series ---

/** The draft with both ends moved by `seconds`, its length and zones kept. */
export function movedDraft(draft: EventDraft, seconds: number): EventDraft {
  if (seconds === 0) return draft
  const { start, finish } = draftInstants(draft)
  const from = new Date((start + seconds) * 1000)
  if (draft.allday) {
    // The instants of an all-day draft run to midnight after its last day.
    const last = new Date((finish + seconds - 1) * 1000)
    return {
      ...draft,
      start: zonedDay(from, draft.zone.start),
      finish: zonedDay(last, draft.zone.finish),
    }
  }
  const to = new Date((finish + seconds) * 1000)
  return {
    ...draft,
    start: zonedDay(from, draft.zone.start),
    startTime: zonedMinutes(from, draft.zone.start),
    finish: zonedDay(to, draft.zone.finish),
    finishTime: zonedMinutes(to, draft.zone.finish),
  }
}

/**
 * The instant a series' master begins, or null for a component without a
 * readable DTSTART.
 */
function masterStart(master: Component, timezone: string): number | null {
  return propertyInstant(property(master, 'DTSTART'), timezone)?.seconds ?? null
}

/**
 * A draft of the series as it stands at the occurrence starting at `start`:
 * the master's own draft with its dates moved onto that occurrence. This is
 * what a change to this occurrence and the ones after it starts from.
 */
export function occurrenceDraft(
  master: Component,
  start: number,
  calendar: string,
  timezone: string
): EventDraft {
  const draft = componentDraft(master, calendar, timezone)
  const first = masterStart(master, timezone)
  return first === null ? draft : movedDraft(draft, start - first)
}

/**
 * The editor's draft moved onto the occurrence at `start`. A draft read from
 * the master carries the series' first dates, so it moves by the distance
 * from the series' start to the occurrence, and the edit's own change of
 * time comes along; one read from the occurrence's override already sits
 * on the occurrence and is left alone.
 */
export function anchoredDraft(
  draft: EventDraft,
  master: Component,
  start: number,
  timezone: string,
  fromMaster: boolean
): EventDraft {
  if (!fromMaster) return draft
  const first = masterStart(master, timezone)
  return first === null ? draft : movedDraft(draft, start - first)
}

/** Each value of a list-valued date property, with the instant it names. */
function dateList(
  item: Property,
  timezone: string
): { value: string; seconds: number | null }[] {
  return item.value.split(',').map((value) => ({
    value: value.trim(),
    seconds: propertyInstant({ ...item, value }, timezone)?.seconds ?? null,
  }))
}

/**
 * A value in the form another value of the same property takes: a whole
 * day, a UTC instant, or a local time in the property's zone.
 */
function valueLike(
  sample: Property,
  seconds: number,
  timezone: string
): string {
  const first = sample.value.split(',')[0].trim()
  const zone = sample.params?.TZID?.[0] ?? ''
  const date = new Date(seconds * 1000)
  if (/^\d{8}$/.test(first)) return dateValue(zonedDay(date, zone || timezone))
  if (first.endsWith('Z')) return utcValue(seconds)
  return dateTimeValue(
    zonedDay(date, zone || timezone),
    zonedMinutes(date, zone || timezone)
  )
}

/**
 * The master's list-valued dates, RDATE and EXDATE, kept to one side of a
 * cut: `before` keeps those naming instants before `start`, `after` the rest,
 * each moved by `shift` seconds. A property left with no values is dropped.
 */
function cutDates(
  properties: Property[],
  start: number,
  shift: number,
  timezone: string
): { before: Property[]; after: Property[] } {
  const before: Property[] = []
  const after: Property[] = []
  for (const item of properties) {
    if (item.name !== 'RDATE' && item.name !== 'EXDATE') {
      before.push(item)
      after.push(item)
      continue
    }
    const early: string[] = []
    const late: string[] = []
    for (const entry of dateList(item, timezone)) {
      if (entry.seconds === null || entry.seconds < start)
        early.push(entry.value)
      else late.push(valueLike(item, entry.seconds + shift, timezone))
    }
    if (early.length) before.push({ ...item, value: early.join(',') })
    if (late.length) after.push({ ...item, value: late.join(',') })
  }
  return { before, after }
}

/**
 * The series cut to end just before the occurrence at `start`: the master's
 * rule gains an UNTIL there and loses any COUNT, and the overrides and listed
 * dates from that occurrence on are dropped. Null when the occurrence is the
 * series' first, since nothing would be left, or when the event is no series.
 */
export function truncatedSeries(
  components: Component[],
  start: number,
  timezone: string
): Component[] | null {
  const master = masterComponent(components)
  if (!master) return null
  const rule = propertyValue(master, 'RRULE')
  const first = masterStart(master, timezone)
  if (!rule || first === null || start <= first) return null
  const dtstart = property(master, 'DTSTART')!
  const zone = dtstart.params?.TZID?.[0] ?? ''
  // UNTIL is inclusive, and takes the form of DTSTART: the day before for
  // a whole-day series, otherwise the second before, in UTC.
  const until = /^\d{8}$/.test(dtstart.value)
    ? dateValue(addDays(zonedDay(new Date(start * 1000), zone || timezone), -1))
    : utcValue(start - 1)
  const parts = rule.split(';').filter((part) => !/^(UNTIL|COUNT)=/i.test(part))
  parts.push(`UNTIL=${until}`)
  const { before } = cutDates(master.properties, start, 0, timezone)
  const properties = before.map((item) =>
    item.name === 'RRULE' ? { ...item, value: parts.join(';') } : item
  )
  const kept = components.filter((item) => {
    if (item === master) return false
    if (item.name !== 'VEVENT') return true
    const id = property(item, 'RECURRENCE-ID')
    const instant = id ? propertyInstant(id, timezone) : null
    return instant === null || instant.seconds < start
  })
  return [{ ...master, properties }, ...kept]
}

/**
 * An edit of the occurrence at `start` and every one after it: the series is
 * cut in two. `before` is the old event, ending just before the occurrence;
 * `after` is a new event whose master is `draft`, the series as it now goes
 * on from there, so the draft's dates are where this occurrence lands. The
 * old overrides and listed dates from the cut onwards move to the new event,
 * shifted as the draft shifted the occurrence, and its rule keeps the old
 * one's end; a COUNT is left for the server to shorten by the occurrences
 * the old event keeps. Null when the occurrence is the series' first, which
 * makes the edit one of the whole series.
 */
export function splitSeries(
  components: Component[],
  draft: EventDraft,
  start: number,
  timezone: string
): { before: Component[]; after: Component[] } | null {
  const before = truncatedSeries(components, start, timezone)
  const master = masterComponent(components)
  if (!before || !master) return null
  const shift = draftInstants(draft).start - start
  const head = draftComponent(draft, master)
  const { after: dates } = cutDates(master.properties, start, shift, timezone)
  const listed = dates.filter(
    (item) => item.name === 'RDATE' || item.name === 'EXDATE'
  )
  const properties = [
    ...head.properties.filter(
      (item) => item.name !== 'RDATE' && item.name !== 'EXDATE'
    ),
    ...listed,
  ]
  const carried = carriedOverrides(
    components,
    master,
    head,
    start,
    shift,
    draft.calendar,
    timezone
  )
  return { before, after: [{ ...head, properties }, ...carried] }
}

/**
 * The overrides of occurrences at or after `from`, following a master that
 * moved by `shift` seconds: each keeps its own title and length, moves by
 * the same shift, and names its occurrence as the new master does.
 */
function carriedOverrides(
  components: Component[],
  master: Component,
  head: Component,
  from: number,
  shift: number,
  calendar: string,
  timezone: string
): Component[] {
  const series = new Set(['RECURRENCE-ID', 'RRULE', 'RDATE', 'EXDATE'])
  const out: Component[] = []
  for (const item of components) {
    if (item === master || item.name !== 'VEVENT') continue
    const id = property(item, 'RECURRENCE-ID')
    const instant = id ? propertyInstant(id, timezone) : null
    if (instant === null || instant.seconds < from) continue
    if (shift === 0) {
      out.push(item)
      continue
    }
    const own = movedDraft(componentDraft(item, calendar, timezone), shift)
    const rewritten = draftComponent({ ...own, repeat: emptyRepeat() }, item)
    out.push({
      ...rewritten,
      properties: [
        ...rewritten.properties.filter((entry) => !series.has(entry.name)),
        recurrenceIdentifier(head, instant.seconds + shift, timezone),
      ],
    })
  }
  return out
}

// --- Copying ---

/**
 * The draft a copy of an occurrence opens the editor on: for "This event",
 * the occurrence alone, its own override where it has one and otherwise
 * the master moved onto it, with no repeat; for "All events", the whole
 * series as its master describes it. Null without a master to copy.
 */
export function copyDraft(
  components: Component[],
  start: number,
  calendar: string,
  timezone: string,
  scope: 'one' | 'all'
): EventDraft | null {
  const master = masterComponent(components)
  if (!master) return null
  if (scope === 'all') return componentDraft(master, calendar, timezone)
  const override = overrideComponent(components, start, timezone)
  const own = override
    ? componentDraft(override, calendar, timezone)
    : occurrenceDraft(master, start, calendar, timezone)
  return { ...own, repeat: emptyRepeat() }
}

/**
 * The draft a copy of an occurrence with no stored event to read opens on,
 * such as a subscribed calendar's or a derived birthday: what the listing
 * itself says about it, as one event in the user's zone.
 */
export function instanceDraft(
  instance: {
    summary: string
    location: string
    description: string
    start: number
    finish: number
    allday: boolean
    date?: string
  },
  calendar: string,
  reminder: number,
  timezone: string
): EventDraft {
  const begins = new Date(instance.start * 1000)
  const ends = new Date(instance.finish * 1000)
  // An all-day occurrence is listed by its date and runs to the midnight
  // after its last day, so its last day is one short of its length.
  const date = instance.date ?? zonedDay(begins, timezone)
  const days = Math.max(
    1,
    Math.round((instance.finish - instance.start) / 86400)
  )
  return {
    title: instance.summary,
    calendar,
    allday: instance.allday,
    start: instance.allday ? date : zonedDay(begins, timezone),
    startTime: instance.allday ? 0 : zonedMinutes(begins, timezone),
    finish: instance.allday
      ? addDays(date, days - 1)
      : zonedDay(ends, timezone),
    finishTime: instance.allday ? 0 : zonedMinutes(ends, timezone),
    zone: { start: timezone, finish: timezone },
    location: instance.location,
    description: instance.description,
    repeat: emptyRepeat(),
    reminder,
  }
}

// --- New events ---

/**
 * What the next new event takes from the last one saved on this device:
 * whether it was all-day, which only "New event" has nothing else to go on
 * for, and the zones of its two ends, so a run of events entered for a trip
 * reads in the trip's zone. Nothing else carries over.
 */
export interface Remembered {
  allday: boolean
  zone: { start: string; finish: string } | null
}

export const REMEMBERED: Remembered = { allday: false, zone: null }

/** What a saved new event leaves for the next one. */
export function remembered(draft: EventDraft): Remembered {
  return { allday: draft.allday, zone: { ...draft.zone } }
}

/**
 * The draft a new event opens on: the span in unix seconds, read in the
 * zones the last new event used, so a tap at ten keeps its instant and the
 * editor shows it on the remembered clock.
 */
export function newDraft(
  from: number,
  to: number,
  options: {
    allday: boolean
    calendar: string
    reminder: number
    zone: { start: string; finish: string }
  }
): EventDraft {
  const { zone } = options
  const begins = new Date(from * 1000)
  const ends = new Date(to * 1000)
  return {
    title: '',
    calendar: options.calendar,
    allday: options.allday,
    start: zonedDay(begins, zone.start),
    startTime: zonedMinutes(begins, zone.start),
    finish: zonedDay(ends, zone.finish),
    finishTime: zonedMinutes(ends, zone.finish),
    zone: { ...zone },
    location: '',
    description: '',
    repeat: emptyRepeat(),
    reminder: options.reminder,
  }
}

/**
 * The draft with its end no earlier than its start as instants. A zone
 * change keeps each end's clock reading, so an end zone chosen east of the
 * start can put the end before the start; the end then moves on by whole
 * days until it follows, which is where an eastbound arrival lands anyway.
 */
export function endAfterStart(draft: EventDraft): EventDraft {
  if (draft.allday) return draft
  let out = draft
  for (let step = 0; step < 3; step++) {
    const { start, finish } = draftInstants(out)
    if (finish >= start) return out
    const days = Math.max(1, Math.ceil((start - finish) / 86400))
    out = { ...out, finish: addDays(out.finish, days) }
  }
  return out
}
