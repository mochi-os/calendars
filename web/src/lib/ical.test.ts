// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { describe, expect, it } from 'vitest'
import type { Component } from '@/api/types/events'
import {
  componentDraft,
  deletedOccurrence,
  draftComponent,
  draftInstants,
  editedComponents,
  foreignZones,
  emptyRepeat,
  masterComponent,
  property,
  propertyInstant,
  propertyValue,
  reminderTrigger,
  repeatRule,
  ruleRepeat,
  triggerMinutes,
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
      { name: 'DTSTART', params: { TZID: ['Europe/London'] }, value: '20260916T090000' },
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
        { ...emptyRepeat(), frequency: 'weekly', interval: 2, weekdays: [1, 3] },
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
    expect(ruleRepeat('FREQ=DAILY;UNTIL=20260930T225959Z', ZONE)).toMatchObject({
      ending: 'until',
      until: '2026-09-30',
    })
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
      draft({ title: 'Renamed', repeat: { ...emptyRepeat(), frequency: 'daily' } }),
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
    expect(property(component, 'DTSTART')?.params.TZID).toEqual(['Europe/London'])
    expect(property(component, 'DTEND')?.params.TZID).toEqual(['America/New_York'])
    // 10:00 London is 09:00Z, 13:00 New York is 17:00Z: eight hours.
    const { start, finish } = draftInstants(flight)
    expect(finish - start).toBe(8 * 3600)
  })

  it('reads each end back in its own zone', () => {
    const read = componentDraft(draftComponent(flight), 'cal', 'UTC')
    expect(read.zone).toEqual({ start: 'Europe/London', finish: 'America/New_York' })
    expect([read.startTime, read.finishTime]).toEqual([600, 780])
  })

  it('gives a DTEND without a zone the start zone, and neither the user zone', () => {
    const one = componentDraft(
      {
        name: 'VEVENT',
        properties: [
          { name: 'DTSTART', params: { TZID: ['Asia/Tokyo'] }, value: '20260925T090000' },
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
    expect(none.zone).toEqual({ start: 'Europe/London', finish: 'Europe/London' })
  })

  it('tells an end that precedes its start as an instant from one that only reads earlier', () => {
    // Monday 10:00 Auckland to Sunday 15:00 Tahiti reads backwards but is four hours on.
    const hop = { ...flight, start: '2026-09-28', finish: '2026-09-27', finishTime: 900, zone: { start: 'Pacific/Auckland', finish: 'Pacific/Tahiti' } }
    expect(draftInstants(hop).finish - draftInstants(hop).start).toBe(4 * 3600)
    const wrong = { ...flight, finishTime: 540, zone: { start: 'Europe/London', finish: 'Europe/London' } }
    expect(draftInstants(wrong).finish < draftInstants(wrong).start).toBe(true)
  })
})

describe('foreignZones', () => {
  const user = 'Europe/London'
  it('says nothing when both ends are in the user zone, which a zone-less event also is', () => {
    expect(foreignZones(draft({ allday: false, zone: { start: user, finish: user } }), user)).toBe(false)
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
    expect(foreignZones(draft({ allday: false, zone: { start: user, finish: 'America/New_York' } }), user)).toBe(true)
    expect(foreignZones(draft({ allday: false, zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' } }), user)).toBe(true)
    expect(foreignZones(draft({ allday: true, zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' } }), user)).toBe(false)
  })
})

