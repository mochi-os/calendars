// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { describe, expect, it } from 'vitest'
import type { Component } from '@/api/types/events'
import {
  anchoredDraft,
  componentDraft,
  copyDraft,
  deletedOccurrence,
  draftComponent,
  draftInstants,
  editedComponents,
  endAfterStart,
  expressible,
  foreignZones,
  emptyRepeat,
  instanceDraft,
  masterComponent,
  movedDraft,
  newDraft,
  occurrenceDraft,
  property,
  propertyInstant,
  propertyValue,
  REMEMBERED,
  remembered,
  reminderTrigger,
  repeatRule,
  ruleRepeat,
  splitSeries,
  triggerMinutes,
  truncatedSeries,
  utcValue,
  type EventDraft,
} from './ical'

const ZONE = 'Europe/London'

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Standup',
    calendar: 'cal1',
    allday: false,
    start: '2026-09-16',
    startTime: 9 * 60,
    finish: '2026-09-16',
    finishTime: 10 * 60,
    zone: { start: ZONE, finish: ZONE },
    location: '',
    description: '',
    repeat: emptyRepeat(),
    reminder: 15,
    ...overrides,
  }
}

describe('property values', () => {
  it('reads a whole-day value as the start of that day in the zone', () => {
    const instant = propertyInstant(
      { name: 'DTSTART', params: { VALUE: ['DATE'] }, value: '20260916' },
      ZONE
    )
    expect(instant?.allday).toBe(true)
    // 2026-09-16 is British Summer Time, an hour ahead of UTC.
    expect(utcValue(instant!.seconds)).toBe('20260915T230000Z')
  })

  it('reads a zoned value through its TZID', () => {
    const instant = propertyInstant(
      {
        name: 'DTSTART',
        params: { TZID: ['Europe/London'] },
        value: '20260916T090000',
      },
      'UTC'
    )
    expect(utcValue(instant!.seconds)).toBe('20260916T080000Z')
    expect(instant?.zone).toBe('Europe/London')
  })

  it('reads a UTC value as written, whatever the user zone', () => {
    const instant = propertyInstant(
      { name: 'DTSTART', params: {}, value: '20260916T080000Z' },
      'Asia/Tokyo'
    )
    expect(utcValue(instant!.seconds)).toBe('20260916T080000Z')
  })

  it('reads a floating value in the user zone', () => {
    const instant = propertyInstant(
      { name: 'DTSTART', params: {}, value: '20260916T090000' },
      'Europe/London'
    )
    expect(utcValue(instant!.seconds)).toBe('20260916T080000Z')
  })

  it('answers nothing for a value it cannot read', () => {
    expect(propertyInstant(undefined, ZONE)).toBeNull()
    expect(
      propertyInstant({ name: 'DTSTART', params: {}, value: 'soon' }, ZONE)
    ).toBeNull()
  })
})

describe('repeat rules', () => {
  it('writes the frequency, interval and weekdays', () => {
    expect(
      repeatRule(
        {
          ...emptyRepeat(),
          frequency: 'weekly',
          interval: 2,
          weekdays: [1, 3],
        },
        ZONE
      )
    ).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
    expect(repeatRule({ ...emptyRepeat(), frequency: 'daily' }, ZONE)).toBe(
      'FREQ=DAILY'
    )
    expect(repeatRule(emptyRepeat(), ZONE)).toBe('')
  })

  it('writes an end date that includes the whole last day', () => {
    const rule = repeatRule(
      {
        ...emptyRepeat(),
        frequency: 'daily',
        ending: 'until',
        until: '2026-09-30',
      },
      ZONE
    )
    expect(rule).toBe('FREQ=DAILY;UNTIL=20260930T225959Z')
  })

  it('writes a count', () => {
    expect(
      repeatRule(
        { ...emptyRepeat(), frequency: 'monthly', ending: 'count', count: 5 },
        ZONE
      )
    ).toBe('FREQ=MONTHLY;COUNT=5')
  })

  it('reads a rule back into the same settings', () => {
    const repeat = ruleRepeat('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', ZONE)
    expect(repeat.frequency).toBe('weekly')
    expect(repeat.interval).toBe(2)
    expect(repeat.weekdays).toEqual([1, 3])
    expect(repeat.ending).toBe('never')
  })

  it('reads an end date and a count', () => {
    expect(ruleRepeat('FREQ=DAILY;UNTIL=20260930T225959Z', ZONE)).toMatchObject(
      {
        ending: 'until',
        until: '2026-09-30',
      }
    )
    expect(ruleRepeat('FREQ=DAILY;COUNT=3', ZONE)).toMatchObject({
      ending: 'count',
      count: 3,
    })
  })

  it('reads an ordinal weekday as its weekday', () => {
    expect(ruleRepeat('FREQ=MONTHLY;BYDAY=2TU', ZONE).weekdays).toEqual([2])
  })

  it('ignores a rule it does not understand', () => {
    expect(ruleRepeat('FREQ=HOURLY', ZONE).frequency).toBe('never')
    expect(ruleRepeat('', ZONE).frequency).toBe('never')
  })
})

describe('reminders', () => {
  it('writes the shortest duration that says it', () => {
    expect(reminderTrigger(0)).toBe('PT0M')
    expect(reminderTrigger(15)).toBe('-PT15M')
    expect(reminderTrigger(60)).toBe('-PT1H')
    expect(reminderTrigger(1440)).toBe('-P1D')
  })

  it('reads a trigger back as minutes before the start', () => {
    expect(triggerMinutes('-PT15M')).toBe(15)
    expect(triggerMinutes('-PT1H')).toBe(60)
    expect(triggerMinutes('-P1D')).toBe(1440)
    expect(triggerMinutes('PT0M')).toBe(0)
    // A trigger after the start is a negative lead, not a reminder before it.
    expect(triggerMinutes('PT30M')).toBe(-30)
    expect(triggerMinutes('nonsense')).toBeNull()
  })
})

describe('draftComponent', () => {
  it('writes a timed event with its zone', () => {
    const component = draftComponent(draft())
    expect(propertyValue(component, 'SUMMARY')).toBe('Standup')
    expect(property(component, 'DTSTART')).toEqual({
      name: 'DTSTART',
      params: { TZID: [ZONE] },
      value: '20260916T090000',
    })
    expect(property(component, 'DTEND')?.value).toBe('20260916T100000')
  })

  it('writes an all-day event with an exclusive end', () => {
    const component = draftComponent(
      draft({ allday: true, start: '2026-09-16', finish: '2026-09-17' })
    )
    expect(property(component, 'DTSTART')).toEqual({
      name: 'DTSTART',
      params: { VALUE: ['DATE'] },
      value: '20260916',
    })
    expect(property(component, 'DTEND')?.value).toBe('20260918')
  })

  it('leaves out an empty location and description', () => {
    const component = draftComponent(draft())
    expect(property(component, 'LOCATION')).toBeUndefined()
    expect(property(component, 'DESCRIPTION')).toBeUndefined()
  })

  it('writes the reminder as an alarm and none when there is none', () => {
    const withAlarm = draftComponent(draft({ reminder: 30 }))
    expect(withAlarm.components).toHaveLength(1)
    expect(propertyValue(withAlarm.components[0], 'TRIGGER')).toBe('-PT30M')
    expect(draftComponent(draft({ reminder: -1 })).components).toHaveLength(0)
  })

  it('carries over properties the editor does not own', () => {
    const previous: Component = {
      name: 'VEVENT',
      properties: [
        { name: 'SUMMARY', params: {}, value: 'Old' },
        { name: 'TRANSP', params: {}, value: 'TRANSPARENT' },
        { name: 'CLASS', params: {}, value: 'PRIVATE' },
      ],
      components: [
        { name: 'VALARM', properties: [], components: [] },
        { name: 'VOTHER', properties: [], components: [] },
      ],
    }
    const component = draftComponent(draft({ reminder: -1 }), previous)
    expect(propertyValue(component, 'SUMMARY')).toBe('Standup')
    expect(propertyValue(component, 'TRANSP')).toBe('TRANSPARENT')
    expect(propertyValue(component, 'CLASS')).toBe('PRIVATE')
    expect(component.components.map((item) => item.name)).toEqual(['VOTHER'])
  })
})

describe('componentDraft', () => {
  it('reads a timed event back into the same draft', () => {
    const original = draft({ location: 'Room 1', description: 'Notes' })
    const read = componentDraft(draftComponent(original), 'cal1', 'UTC')
    expect(read).toEqual(original)
  })

  it('reads an all-day event back with its last day, not the exclusive end', () => {
    const original = draft({
      allday: true,
      start: '2026-09-16',
      finish: '2026-09-18',
      startTime: 0,
      finishTime: 0,
    })
    const read = componentDraft(draftComponent(original), 'cal1', ZONE)
    expect(read.allday).toBe(true)
    expect(read.start).toBe('2026-09-16')
    expect(read.finish).toBe('2026-09-18')
  })

  it('reads a repeating event back into the same rule', () => {
    const original = draft({
      repeat: {
        ...emptyRepeat(),
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 3, 5],
      },
    })
    const read = componentDraft(draftComponent(original), 'cal1', 'UTC')
    expect(read.repeat.frequency).toBe('weekly')
    expect(read.repeat.weekdays).toEqual([1, 3, 5])
  })

  it('treats an event with no end as ending where it starts', () => {
    const component: Component = {
      name: 'VEVENT',
      properties: [
        { name: 'SUMMARY', params: {}, value: 'Point' },
        { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260916T090000' },
      ],
      components: [],
    }
    const read = componentDraft(component, 'cal1', ZONE)
    expect(read.start).toBe('2026-09-16')
    expect(read.startTime).toBe(540)
    expect(read.finishTime).toBe(540)
  })
})

describe('editing one occurrence of a series', () => {
  const series = draftComponent(
    draft({ repeat: { ...emptyRepeat(), frequency: 'daily' } })
  )
  // The second occurrence, 2026-09-17 09:00 London.
  const occurrence = propertyInstant(
    { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260917T090000' },
    ZONE
  )!.seconds

  it('rewrites the master for "All events"', () => {
    const components = editedComponents(
      [series],
      draft({
        title: 'Renamed',
        repeat: { ...emptyRepeat(), frequency: 'daily' },
      }),
      'all',
      occurrence,
      ZONE
    )
    expect(components).toHaveLength(1)
    expect(propertyValue(components[0], 'SUMMARY')).toBe('Renamed')
    expect(propertyValue(components[0], 'RRULE')).toBe('FREQ=DAILY')
  })

  it('adds an override carrying a matching RECURRENCE-ID for "This event"', () => {
    const components = editedComponents(
      [series],
      draft({
        title: 'Just once',
        start: '2026-09-17',
        startTime: 11 * 60,
        finish: '2026-09-17',
        finishTime: 12 * 60,
      }),
      'one',
      occurrence,
      ZONE
    )
    expect(components).toHaveLength(2)
    const override = components[1]
    expect(propertyValue(override, 'SUMMARY')).toBe('Just once')
    expect(property(override, 'RECURRENCE-ID')).toEqual({
      name: 'RECURRENCE-ID',
      params: { TZID: [ZONE] },
      value: '20260917T090000',
    })
    // The override describes one occurrence, so it carries no rule of its own.
    expect(property(override, 'RRULE')).toBeUndefined()
    expect(propertyValue(components[0], 'RRULE')).toBe('FREQ=DAILY')
  })

  it('replaces an earlier override of the same occurrence', () => {
    const first = editedComponents(
      [series],
      draft({ title: 'First' }),
      'one',
      occurrence,
      ZONE
    )
    const second = editedComponents(
      first,
      draft({ title: 'Second' }),
      'one',
      occurrence,
      ZONE
    )
    expect(second).toHaveLength(2)
    expect(propertyValue(second[1], 'SUMMARY')).toBe('Second')
  })

  it('keeps the series own rule and exception dates off the override', () => {
    const withException = deletedOccurrence([series], occurrence, ZONE)!
    const components = editedComponents(
      withException,
      draft({ title: 'Just once' }),
      'one',
      propertyInstant(
        { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260918T090000' },
        ZONE
      )!.seconds,
      ZONE
    )
    const override = components[components.length - 1]
    expect(property(override, 'RRULE')).toBeUndefined()
    expect(property(override, 'EXDATE')).toBeUndefined()
    expect(propertyValue(components[0], 'EXDATE')).toBe('20260917T090000')
  })

  it('names the master by date when the series is all-day', () => {
    const allday = draftComponent(
      draft({
        allday: true,
        start: '2026-09-16',
        finish: '2026-09-16',
        repeat: { ...emptyRepeat(), frequency: 'daily' },
      })
    )
    const day = propertyInstant(
      { name: 'DTSTART', params: { VALUE: ['DATE'] }, value: '20260917' },
      ZONE
    )!.seconds
    const components = editedComponents(
      [allday],
      draft({ allday: true, start: '2026-09-17', finish: '2026-09-17' }),
      'one',
      day,
      ZONE
    )
    expect(property(components[1], 'RECURRENCE-ID')).toEqual({
      name: 'RECURRENCE-ID',
      params: { VALUE: ['DATE'] },
      value: '20260917',
    })
  })
})

describe('deleting one occurrence of a series', () => {
  const series = draftComponent(
    draft({ repeat: { ...emptyRepeat(), frequency: 'daily' } })
  )
  const occurrence = propertyInstant(
    { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260917T090000' },
    ZONE
  )!.seconds

  it('adds the occurrence to the master exception list', () => {
    const components = deletedOccurrence([series], occurrence, ZONE)!
    expect(property(components[0], 'EXDATE')).toEqual({
      name: 'EXDATE',
      params: { TZID: [ZONE] },
      value: '20260917T090000',
    })
  })

  it('appends a second exception to the same property', () => {
    const once = deletedOccurrence([series], occurrence, ZONE)!
    const later = propertyInstant(
      { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260918T090000' },
      ZONE
    )!.seconds
    const twice = deletedOccurrence(once, later, ZONE)!
    expect(propertyValue(twice[0], 'EXDATE')).toBe(
      '20260917T090000,20260918T090000'
    )
  })

  it('drops an override of the occurrence it excludes', () => {
    const withOverride = editedComponents(
      [series],
      draft({ title: 'Moved' }),
      'one',
      occurrence,
      ZONE
    )
    const components = deletedOccurrence(withOverride, occurrence, ZONE)!
    expect(components).toHaveLength(1)
    expect(propertyValue(components[0], 'EXDATE')).toBe('20260917T090000')
  })

  it('answers nothing when there is no master to change', () => {
    expect(deletedOccurrence([], occurrence, ZONE)).toBeNull()
  })
})

describe('masterComponent', () => {
  it('picks the component with no RECURRENCE-ID', () => {
    const master: Component = {
      name: 'VEVENT',
      properties: [{ name: 'SUMMARY', params: {}, value: 'Series' }],
      components: [],
    }
    const override: Component = {
      name: 'VEVENT',
      properties: [
        { name: 'RECURRENCE-ID', params: {}, value: '20260917T080000Z' },
      ],
      components: [],
    }
    expect(masterComponent([override, master])).toBe(master)
    expect(masterComponent([])).toBeUndefined()
  })
})

describe('a zone per end', () => {
  const flight: EventDraft = {
    ...draft(),
    allday: false,
    start: '2026-09-25',
    startTime: 600,
    finish: '2026-09-25',
    finishTime: 780,
    zone: { start: 'Europe/London', finish: 'America/New_York' },
  }

  it('writes each end with its own TZID', () => {
    const component = draftComponent(flight)
    expect(property(component, 'DTSTART')?.params.TZID).toEqual([
      'Europe/London',
    ])
    expect(property(component, 'DTEND')?.params.TZID).toEqual([
      'America/New_York',
    ])
    // 10:00 London is 09:00Z, 13:00 New York is 17:00Z: eight hours.
    const { start, finish } = draftInstants(flight)
    expect(finish - start).toBe(8 * 3600)
  })

  it('reads each end back in its own zone', () => {
    const read = componentDraft(draftComponent(flight), 'cal', 'UTC')
    expect(read.zone).toEqual({
      start: 'Europe/London',
      finish: 'America/New_York',
    })
    expect([read.startTime, read.finishTime]).toEqual([600, 780])
  })

  it('gives a DTEND without a zone the start zone, and neither the user zone', () => {
    const one = componentDraft(
      {
        name: 'VEVENT',
        properties: [
          {
            name: 'DTSTART',
            params: { TZID: ['Asia/Tokyo'] },
            value: '20260925T090000',
          },
          { name: 'DTEND', params: {}, value: '20260925T003000Z' },
        ],
        components: [],
      },
      'cal',
      'Europe/London'
    )
    expect(one.zone).toEqual({ start: 'Asia/Tokyo', finish: 'Asia/Tokyo' })
    const none = componentDraft(
      {
        name: 'VEVENT',
        properties: [
          { name: 'DTSTART', params: {}, value: '20260925T090000Z' },
          { name: 'DTEND', params: {}, value: '20260925T100000Z' },
        ],
        components: [],
      },
      'cal',
      'Europe/London'
    )
    expect(none.zone).toEqual({
      start: 'Europe/London',
      finish: 'Europe/London',
    })
  })

  it('tells an end that precedes its start as an instant from one that only reads earlier', () => {
    // Monday 10:00 Auckland to Sunday 15:00 Tahiti reads backwards but is four hours on.
    const hop = {
      ...flight,
      start: '2026-09-28',
      finish: '2026-09-27',
      finishTime: 900,
      zone: { start: 'Pacific/Auckland', finish: 'Pacific/Tahiti' },
    }
    expect(draftInstants(hop).finish - draftInstants(hop).start).toBe(4 * 3600)
    const wrong = {
      ...flight,
      finishTime: 540,
      zone: { start: 'Europe/London', finish: 'Europe/London' },
    }
    expect(draftInstants(wrong).finish < draftInstants(wrong).start).toBe(true)
  })
})

describe('foreignZones', () => {
  const user = 'Europe/London'
  it('says nothing when both ends are in the user zone, which a zone-less event also is', () => {
    expect(
      foreignZones(
        draft({ allday: false, zone: { start: user, finish: user } }),
        user
      )
    ).toBe(false)
    const none = componentDraft(
      {
        name: 'VEVENT',
        properties: [
          { name: 'DTSTART', params: {}, value: '20260925T090000Z' },
          { name: 'DTEND', params: {}, value: '20260925T100000Z' },
        ],
        components: [],
      },
      'cal',
      user
    )
    expect(foreignZones(none, user)).toBe(false)
  })

  it('shows the zones when either end is elsewhere, never on an all-day event', () => {
    expect(
      foreignZones(
        draft({
          allday: false,
          zone: { start: user, finish: 'America/New_York' },
        }),
        user
      )
    ).toBe(true)
    expect(
      foreignZones(
        draft({
          allday: false,
          zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' },
        }),
        user
      )
    ).toBe(true)
    expect(
      foreignZones(
        draft({
          allday: true,
          zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' },
        }),
        user
      )
    ).toBe(false)
  })
})

describe('cutting a series at an occurrence', () => {
  const daily = { ...emptyRepeat(), frequency: 'daily' as const }
  const series = draftComponent(draft({ repeat: daily }))
  const at = (value: string) =>
    propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
      .seconds
  // The third occurrence, 2026-09-18 09:00 London.
  const third = at('20260918T090000')

  it('ends the old series just before the occurrence, in UTC, dropping any COUNT', () => {
    const counted = draftComponent(
      draft({ repeat: { ...daily, ending: 'count', count: 10 } })
    )
    const before = truncatedSeries([counted], third, ZONE)!
    // 09:00 BST is 08:00 UTC; the last moment before it.
    expect(propertyValue(before[0], 'RRULE')).toBe(
      'FREQ=DAILY;UNTIL=20260918T075959Z'
    )
  })

  it('names the day before for an all-day series', () => {
    const allday = draftComponent(
      draft({
        allday: true,
        start: '2026-09-16',
        finish: '2026-09-16',
        repeat: daily,
      })
    )
    const day = propertyInstant(
      { name: 'DTSTART', params: { VALUE: ['DATE'] }, value: '20260918' },
      ZONE
    )!.seconds
    const before = truncatedSeries([allday], day, ZONE)!
    expect(propertyValue(before[0], 'RRULE')).toBe('FREQ=DAILY;UNTIL=20260917')
  })

  it('keeps the overrides and listed dates before the cut on the old series and drops the rest', () => {
    const earlier = editedComponents(
      [series],
      draft({ title: 'Earlier' }),
      'one',
      at('20260917T090000'),
      ZONE
    )
    const both = editedComponents(
      earlier,
      draft({ title: 'Later' }),
      'one',
      at('20260920T090000'),
      ZONE
    )
    const excluded = deletedOccurrence(both, at('20260919T090000'), ZONE)!
    const before = truncatedSeries(excluded, third, ZONE)!
    expect(before.map((item) => propertyValue(item, 'SUMMARY'))).toEqual([
      'Standup',
      'Earlier',
    ])
    expect(property(before[0], 'EXDATE')).toBeUndefined()
  })

  it('answers nothing for the first occurrence, or for an event that does not repeat', () => {
    expect(truncatedSeries([series], at('20260916T090000'), ZONE)).toBeNull()
    expect(
      truncatedSeries([draftComponent(draft())], at('20260916T090000'), ZONE)
    ).toBeNull()
  })

  it('starts the new series where the occurrence now lands, carrying later overrides and dates along', () => {
    const later = editedComponents(
      [series],
      draft({
        title: 'Later',
        start: '2026-09-20',
        startTime: 14 * 60,
        finish: '2026-09-20',
        finishTime: 15 * 60,
      }),
      'one',
      at('20260920T090000'),
      ZONE
    )
    const excluded = deletedOccurrence(later, at('20260919T090000'), ZONE)!
    // The occurrence dragged an hour later: 10:00 on the 18th.
    const moved = draft({
      start: '2026-09-18',
      startTime: 10 * 60,
      finish: '2026-09-18',
      finishTime: 11 * 60,
      repeat: daily,
    })
    const split = splitSeries(excluded, moved, third, ZONE)!
    expect(propertyValue(split.after[0], 'DTSTART')).toBe('20260918T100000')
    expect(propertyValue(split.after[0], 'RRULE')).toBe('FREQ=DAILY')
    // The excluded 19th moves an hour with the series.
    expect(propertyValue(split.after[0], 'EXDATE')).toBe('20260919T100000')
    // The 20th's override keeps its own title and length, an hour later,
    // and names the occurrence the new series has there.
    const carried = split.after[1]
    expect(propertyValue(carried, 'SUMMARY')).toBe('Later')
    expect(propertyValue(carried, 'DTSTART')).toBe('20260920T150000')
    expect(propertyValue(carried, 'DTEND')).toBe('20260920T160000')
    expect(property(carried, 'RECURRENCE-ID')).toEqual({
      name: 'RECURRENCE-ID',
      params: { TZID: [ZONE] },
      value: '20260920T100000',
    })
    expect(propertyValue(split.before[0], 'RRULE')).toBe(
      'FREQ=DAILY;UNTIL=20260918T075959Z'
    )
    expect(split.before).toHaveLength(1)
  })

  it('moves a draft read from the master onto the occurrence, keeping the edit', () => {
    // The editor showed the 16th and the user set 11:00; the third
    // occurrence therefore lands on the 18th at 11:00.
    const anchored = anchoredDraft(
      draft({ startTime: 11 * 60, finishTime: 12 * 60, repeat: daily }),
      series,
      third,
      ZONE,
      true
    )
    expect(anchored.start).toBe('2026-09-18')
    expect(anchored.startTime).toBe(11 * 60)
    expect(anchored.finish).toBe('2026-09-18')
    // A draft read from the occurrence's own override already sits there.
    const own = draft({ start: '2026-09-18', finish: '2026-09-18' })
    expect(anchoredDraft(own, series, third, ZONE, false)).toBe(own)
  })

  it('reads the series as it stands at a later occurrence', () => {
    const read = occurrenceDraft(series, third, 'cal1', ZONE)
    expect(read.start).toBe('2026-09-18')
    expect(read.startTime).toBe(9 * 60)
    expect(read.repeat.frequency).toBe('daily')
  })

  it('moves an all-day draft by whole days without losing its last day', () => {
    const whole = draft({
      allday: true,
      start: '2026-09-16',
      finish: '2026-09-17',
    })
    const moved = movedDraft(whole, 2 * 86400)
    expect(moved.start).toBe('2026-09-18')
    expect(moved.finish).toBe('2026-09-19')
  })
})

describe('moving a whole series', () => {
  const daily = { ...emptyRepeat(), frequency: 'daily' as const }
  const series = draftComponent(draft({ repeat: daily }))
  const at = (value: string) =>
    propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
      .seconds

  it('takes the overrides and exception dates along when the master moves', () => {
    const withOverride = editedComponents(
      [series],
      draft({
        title: 'Once',
        start: '2026-09-17',
        startTime: 14 * 60,
        finish: '2026-09-17',
        finishTime: 15 * 60,
      }),
      'one',
      at('20260917T090000'),
      ZONE
    )
    const excluded = deletedOccurrence(
      withOverride,
      at('20260918T090000'),
      ZONE
    )!
    const moved = editedComponents(
      excluded,
      draft({ startTime: 10 * 60, finishTime: 11 * 60, repeat: daily }),
      'all',
      at('20260917T090000'),
      ZONE
    )
    expect(propertyValue(moved[0], 'DTSTART')).toBe('20260916T100000')
    expect(propertyValue(moved[0], 'EXDATE')).toBe('20260918T100000')
    const override = moved[1]
    expect(propertyValue(override, 'SUMMARY')).toBe('Once')
    expect(propertyValue(override, 'DTSTART')).toBe('20260917T150000')
    expect(propertyValue(override, 'RECURRENCE-ID')).toBe('20260917T100000')
  })

  it('leaves the overrides alone when only the title changes', () => {
    const withOverride = editedComponents(
      [series],
      draft({ title: 'Once' }),
      'one',
      at('20260917T090000'),
      ZONE
    )
    const renamed = editedComponents(
      withOverride,
      draft({ title: 'Renamed', repeat: daily }),
      'all',
      at('20260917T090000'),
      ZONE
    )
    expect(renamed[1]).toBe(withOverride[1])
  })
})

describe('a rule the editor cannot express', () => {
  const second = 'FREQ=MONTHLY;BYDAY=2TU'
  const lastSunday = 'FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'

  it('is kept as written through a read and a write', () => {
    expect(repeatRule(ruleRepeat(second, ZONE), ZONE)).toBe(second)
    expect(repeatRule(ruleRepeat(lastSunday, ZONE), ZONE)).toBe(lastSunday)
    expect(
      repeatRule(ruleRepeat('FREQ=MONTHLY;BYMONTHDAY=1,15', ZONE), ZONE)
    ).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15')
  })

  it('is written from the settings once they change', () => {
    const read = ruleRepeat(second, ZONE)
    expect(repeatRule({ ...read, rule: '', frequency: 'weekly' }, ZONE)).toBe(
      'FREQ=WEEKLY;BYDAY=TU'
    )
    expect(repeatRule({ ...emptyRepeat(), frequency: 'daily' }, ZONE)).toBe(
      'FREQ=DAILY'
    )
  })

  it('tells a rule the settings can say from one they cannot', () => {
    expect(expressible('')).toBe(true)
    expect(expressible('FREQ=DAILY')).toBe(true)
    expect(expressible('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe(true)
    expect(expressible('FREQ=MONTHLY;COUNT=5')).toBe(true)
    expect(expressible('FREQ=DAILY;UNTIL=20261231T235959Z')).toBe(true)
    expect(expressible(second)).toBe(false)
    expect(expressible(lastSunday)).toBe(false)
    expect(expressible('FREQ=MONTHLY;BYMONTHDAY=15')).toBe(false)
    expect(expressible('FREQ=MONTHLY;BYDAY=TU')).toBe(false)
    expect(expressible('FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1')).toBe(false)
    expect(expressible('FREQ=WEEKLY;BYDAY=MON')).toBe(false)
    expect(expressible('FREQ=HOURLY')).toBe(false)
    expect(expressible('FREQ=DAILY;COUNT=3;UNTIL=20261231T235959Z')).toBe(false)
  })

  it('survives a title change of the whole series', () => {
    const series = draftComponent(draft({ repeat: ruleRepeat(second, ZONE) }))
    expect(propertyValue(series, 'RRULE')).toBe(second)
    const read = componentDraft(series, 'cal1', ZONE)
    const renamed = editedComponents(
      [series],
      { ...read, title: 'Renamed' },
      'all',
      propertyInstant(property(series, 'DTSTART'), ZONE)!.seconds,
      ZONE
    )
    expect(propertyValue(renamed[0], 'RRULE')).toBe(second)
    expect(propertyValue(renamed[0], 'SUMMARY')).toBe('Renamed')
  })

  it('goes on to the second half of a cut series', () => {
    const series = draftComponent(
      draft({
        start: '2026-09-08',
        finish: '2026-09-08',
        repeat: ruleRepeat(second, ZONE),
      })
    )
    // The third occurrence, the second Tuesday of November, moved an hour.
    const third = propertyInstant(
      { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20261110T090000' },
      ZONE
    )!.seconds
    const moved = movedDraft(occurrenceDraft(series, third, 'cal1', ZONE), 3600)
    const split = splitSeries([series], moved, third, ZONE)!
    expect(propertyValue(split.after[0], 'RRULE')).toBe(second)
    expect(propertyValue(split.after[0], 'DTSTART')).toBe('20261110T100000')
    expect(propertyValue(split.before[0], 'RRULE')).toBe(
      'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261110T085959Z'
    )
  })
})

describe('the draft a copy opens on', () => {
  const daily = { ...emptyRepeat(), frequency: 'daily' as const }
  const series = draftComponent(draft({ repeat: daily, location: 'Room 4' }))
  const at = (value: string) =>
    propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
      .seconds
  const third = at('20260918T090000')

  it('copies one occurrence as a single event on its own day', () => {
    const copied = copyDraft([series], third, 'cal2', ZONE, 'one')!
    expect(copied.title).toBe('Standup')
    expect(copied.location).toBe('Room 4')
    expect(copied.calendar).toBe('cal2')
    expect(copied.start).toBe('2026-09-18')
    expect(copied.startTime).toBe(9 * 60)
    expect(copied.repeat.frequency).toBe('never')
    expect(copied.repeat.rule).toBe('')
  })

  it('copies one occurrence from its own override when it has one', () => {
    const edited = editedComponents(
      [series],
      draft({
        title: 'Just once',
        start: '2026-09-18',
        startTime: 11 * 60,
        finish: '2026-09-18',
        finishTime: 12 * 60,
      }),
      'one',
      third,
      ZONE
    )
    const copied = copyDraft(edited, third, 'cal1', ZONE, 'one')!
    expect(copied.title).toBe('Just once')
    expect(copied.startTime).toBe(11 * 60)
    expect(copied.repeat.frequency).toBe('never')
  })

  it('copies the whole series with its rule and first day', () => {
    const copied = copyDraft([series], third, 'cal1', ZONE, 'all')!
    expect(copied.start).toBe('2026-09-16')
    expect(copied.repeat.frequency).toBe('daily')
    expect(repeatRule(copied.repeat, ZONE)).toBe('FREQ=DAILY')
  })

  it('answers nothing without a master', () => {
    expect(copyDraft([], third, 'cal1', ZONE, 'one')).toBeNull()
  })

  it('reads a listed occurrence into a single event in the user zone', () => {
    const start = Date.UTC(2026, 8, 25, 9) / 1000
    const copied = instanceDraft(
      {
        summary: 'Flight',
        location: 'LHR',
        description: 'Gate 12',
        start,
        finish: start + 8 * 3600,
        allday: false,
      },
      'cal1',
      15,
      'UTC'
    )
    expect(copied.title).toBe('Flight')
    expect(copied.start).toBe('2026-09-25')
    expect(copied.startTime).toBe(9 * 60)
    expect(copied.finish).toBe('2026-09-25')
    expect(copied.finishTime).toBe(17 * 60)
    expect(copied.zone).toEqual({ start: 'UTC', finish: 'UTC' })
    expect(copied.reminder).toBe(15)
    expect(copied.repeat.frequency).toBe('never')
  })

  it('reads a listed all-day occurrence with its last day, not the exclusive end', () => {
    const start = Date.UTC(2026, 8, 24) / 1000
    const copied = instanceDraft(
      {
        summary: 'Retreat',
        location: '',
        description: '',
        start,
        finish: start + 3 * 86400,
        allday: true,
        date: '2026-09-24',
      },
      'cal1',
      -1,
      'UTC'
    )
    expect(copied.allday).toBe(true)
    expect(copied.start).toBe('2026-09-24')
    expect(copied.finish).toBe('2026-09-26')
  })
})

describe('what a new event starts from', () => {
  const nine = Date.UTC(2026, 8, 25, 9) / 1000

  it('reads the span in the zones the last new event used, keeping the instants', () => {
    const draft = newDraft(nine, nine + 3600, {
      allday: false,
      calendar: 'cal1',
      reminder: 15,
      zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' },
    })
    // 09:00 UTC is 18:00 in Tokyo, the same instant.
    expect(draft.start).toBe('2026-09-25')
    expect(draft.startTime).toBe(18 * 60)
    expect(draft.finishTime).toBe(19 * 60)
    expect(draft.zone).toEqual({ start: 'Asia/Tokyo', finish: 'Asia/Tokyo' })
    expect(draftInstants(draft)).toEqual({ start: nine, finish: nine + 3600 })
    expect(draft.calendar).toBe('cal1')
    expect(draft.reminder).toBe(15)
    expect(draft.title).toBe('')
    expect(draft.repeat.frequency).toBe('never')
  })

  it('takes the all-day switch it is given', () => {
    const draft = newDraft(nine, nine + 3600, {
      allday: true,
      calendar: 'cal1',
      reminder: -1,
      zone: { start: 'UTC', finish: 'UTC' },
    })
    expect(draft.allday).toBe(true)
    expect(draft.start).toBe('2026-09-25')
  })

  it('leaves the all-day switch and both zones of a saved event for the next', () => {
    const saved = draft({
      title: 'Flight',
      allday: false,
      zone: { start: 'Europe/London', finish: 'America/New_York' },
      location: 'LHR',
    })
    expect(remembered(saved)).toEqual({
      allday: false,
      zone: { start: 'Europe/London', finish: 'America/New_York' },
    })
    expect(remembered({ ...saved, allday: true })).toEqual({
      allday: true,
      zone: { start: 'Europe/London', finish: 'America/New_York' },
    })
    expect(REMEMBERED).toEqual({ allday: false, zone: null })
  })
})

describe('an end that falls before its start after a zone change', () => {
  const london = draft({
    start: '2026-09-24',
    startTime: 11 * 60,
    finish: '2026-09-24',
    finishTime: 12 * 60,
    zone: { start: 'Europe/London', finish: 'Europe/London' },
  })

  it('moves the end on to the next day when its zone is east of the start', () => {
    const tokyo = endAfterStart({
      ...london,
      zone: { start: 'Europe/London', finish: 'Asia/Tokyo' },
    })
    // 12:00 Tokyo on the 24th is 03:00Z, before 11:00 London; the 25th follows.
    expect(tokyo.finish).toBe('2026-09-25')
    expect(tokyo.finishTime).toBe(12 * 60)
    expect(draftInstants(tokyo).finish).toBeGreaterThan(
      draftInstants(tokyo).start
    )
  })

  it('leaves an end that still follows alone, as one west of the start does', () => {
    const newYork = {
      ...london,
      zone: { start: 'Europe/London', finish: 'America/New_York' },
    }
    expect(endAfterStart(newYork)).toBe(newYork)
    expect(endAfterStart(london)).toBe(london)
  })

  it('moves by as many days as the gap needs', () => {
    const far = endAfterStart({
      ...london,
      finish: '2026-09-18',
      zone: { start: 'Europe/London', finish: 'Asia/Tokyo' },
    })
    expect(far.finish).toBe('2026-09-25')
  })

  it('never touches an all-day draft, even one that ends before it starts', () => {
    const whole = { ...london, allday: true, finish: '2026-09-20' }
    expect(endAfterStart(whole)).toBe(whole)
  })
})
