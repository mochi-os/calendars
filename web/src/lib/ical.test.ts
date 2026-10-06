// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { describe, expect, it } from 'vitest'
import type { Component, Property } from '@/api/types/events'
import {
  alarmMinutes,
  creationDay,
  defaultCalendar,
  defaultStart,
  nextReminder,
  componentDraft,
  copyDraft,
  formCopy,
  deletedOccurrence,
  draftComponent,
  draftInstants,
  editedComponents,
  endAfterStart,
  expressible,
  emptyRepeat,
  instanceDraft,
  masterComponent,
  movedDraft,
  newDraft,
  shiftedStart,
  occurrenceDraft,
  openedDraft,
  property,
  propertyInstant,
  propertyValue,
  REMEMBERED,
  remembered,
  reminderTrigger,
  repeatRule,
  ruleRepeat,
  savedComponents,
  savedSplit,
  splitSeries,
  startZone,
  triggerMinutes,
  truncatedSeries,
  utcValue,
  type EventDraft,
} from './ical'

const ZONE = 'Europe/London'

function valarm(
  trigger: string,
  params: Record<string, string[]> = {}
): Component {
  return {
    name: 'VALARM',
    properties: [
      { name: 'ACTION', params: {}, value: 'DISPLAY' },
      { name: 'TRIGGER', params, value: trigger },
    ],
    components: [],
  }
}

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
    colour: '',
    url: '',
    tentative: false,
    description: '',
    original: '',
    repeat: emptyRepeat(),
    reminders: [15],
    ...overrides,
  }
}

describe('property values', () => {
  it('reads and writes an event colour and URL without duplicating properties', () => {
    const original = draftComponent(draft())
    original.properties.push(
      { name: 'COLOR', params: {}, value: '#ff8800' },
      { name: 'URL', params: {}, value: 'https://example.com/meeting' }
    )
    const read = componentDraft(original, 'cal1', ZONE)
    expect(read.colour).toBe('#ff8800')
    expect(read.url).toBe('https://example.com/meeting')
    const saved = draftComponent(
      { ...read, colour: '#00aaff', url: 'https://example.com/new' },
      original
    )
    expect(saved.properties.filter((item) => item.name === 'COLOR')).toEqual([
      { name: 'COLOR', params: {}, value: '#00aaff' },
    ])
    expect(saved.properties.filter((item) => item.name === 'URL')).toEqual([
      { name: 'URL', params: {}, value: 'https://example.com/new' },
    ])
  })

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

  it('ends a whole-day series on a date, as its start is one', () => {
    const until = { ...emptyRepeat(), frequency: 'daily' as const }
    expect(
      repeatRule({ ...until, ending: 'until', until: '2026-09-30' }, ZONE, true)
    ).toBe('FREQ=DAILY;UNTIL=20260930')
    const saved = draftComponent(
      draft({
        allday: true,
        start: '2026-09-16',
        finish: '2026-09-16',
        repeat: { ...until, ending: 'until', until: '2026-09-30' },
      })
    )
    expect(propertyValue(saved, 'RRULE')).toBe('FREQ=DAILY;UNTIL=20260930')
  })

  it('gives a kept rule the end form its start takes when it turns all day or back', () => {
    const timed = ruleRepeat(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260930T225959Z',
      ZONE
    )
    expect(repeatRule(timed, ZONE, true)).toBe(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260930'
    )
    const whole = ruleRepeat('FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261110', ZONE)
    expect(repeatRule(whole, ZONE, false)).toBe(
      'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261110T235959Z'
    )
    // A rule already in the right form goes back as it came.
    expect(repeatRule(timed, ZONE, false)).toBe(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260930T225959Z'
    )
    expect(repeatRule(whole, ZONE, true)).toBe(
      'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261110'
    )
    // Turned all day in the editor or dropped in the all-day band.
    const saved = draftComponent(draft({ allday: true, repeat: timed }))
    expect(propertyValue(saved, 'RRULE')).toBe(
      'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260930'
    )
  })

  it('reads a cut series as ending the day before the cut, so touching its repeat brings nothing back', () => {
    // 09:00 London, an hour ahead of UTC.
    const start = Date.UTC(2026, 8, 1, 8, 0) / 1000
    // Cut at the 18th's occurrence: it ends a second before it.
    const cut = ruleRepeat('FREQ=DAILY;UNTIL=20260918T075959Z', ZONE, start)
    expect(cut.until).toBe('2026-09-17')
    expect(repeatRule({ ...cut, rule: '' }, ZONE)).toBe(
      'FREQ=DAILY;UNTIL=20260917T225959Z'
    )
    // The editor's end, the day's last second, and one on the last
    // occurrence's own start, as Apple writes it, read as their own day.
    expect(
      ruleRepeat('FREQ=DAILY;UNTIL=20260917T225959Z', ZONE, start).until
    ).toBe('2026-09-17')
    expect(
      ruleRepeat('FREQ=DAILY;UNTIL=20260917T080000Z', ZONE, start).until
    ).toBe('2026-09-17')
    expect(ruleRepeat('FREQ=DAILY;UNTIL=20260917', ZONE, start).until).toBe(
      '2026-09-17'
    )
    // Opened in the editor, the series reads by its own start.
    const stored = draftComponent(
      draft({
        repeat: {
          ...emptyRepeat(),
          frequency: 'daily',
          rule: 'FREQ=DAILY;UNTIL=20260918T075959Z',
        },
      })
    )
    expect(componentDraft(stored, 'cal1', ZONE).repeat.until).toBe('2026-09-17')
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

  it('reads only the alarms the reminder setting can say', () => {
    expect(alarmMinutes(valarm('-PT15M'))).toBe(15)
    expect(alarmMinutes(valarm('PT0M'))).toBe(0)
    expect(alarmMinutes(valarm('-PT15M', { RELATED: ['END'] }))).toBeNull()
    expect(
      alarmMinutes(valarm('20260927T120000Z', { VALUE: ['DATE-TIME'] }))
    ).toBeNull()
    expect(alarmMinutes(valarm('PT10M'))).toBeNull()
  })
})

describe('adding a reminder', () => {
  it('starts at the time of the event and each further one is longer', () => {
    const added: number[] = []
    for (let step = 0; step < 6; step++) added.push(nextReminder(added))
    expect(added).toEqual([0, 5, 15, 30, 60, 1440])
  })

  it('takes the shortest the event lacks beside a default reminder', () => {
    expect(nextReminder([15])).toBe(0)
    expect(nextReminder([15, 0])).toBe(5)
    expect(nextReminder([15, 0, 5])).toBe(30)
  })

  it('offers the longest again once every one is taken', () => {
    expect(nextReminder([0, 5, 15, 30, 60, 1440])).toBe(1440)
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

  it('writes each reminder as an alarm and none when there are none', () => {
    const withAlarm = draftComponent(draft({ reminders: [30] }))
    expect(withAlarm.components).toHaveLength(1)
    expect(propertyValue(withAlarm.components[0], 'TRIGGER')).toBe('-PT30M')
    const two = draftComponent(draft({ reminders: [30, 1440] }))
    expect(
      two.components.map((item) => propertyValue(item, 'TRIGGER'))
    ).toEqual(['-PT30M', '-P1D'])
    expect(draftComponent(draft({ reminders: [] })).components).toHaveLength(0)
  })

  it("keeps an event's every reminder through a save that changed something else", () => {
    const previous: Component = {
      name: 'VEVENT',
      properties: [],
      components: [valarm('-PT10M'), valarm('-PT1H')],
    }
    const read = componentDraft(
      { ...draftComponent(draft()), components: previous.components },
      'cal1',
      'UTC'
    )
    const saved = draftComponent({ ...read, title: 'Renamed' }, previous)
    expect(
      saved.components.map((item) => propertyValue(item, 'TRIGGER'))
    ).toEqual(['-PT10M', '-PT1H'])
  })

  it('keeps the alarms the reminder setting cannot say, replacing the rest', () => {
    const previous: Component = {
      name: 'VEVENT',
      properties: [],
      components: [
        valarm('-PT15M'),
        valarm('-PT30M', { RELATED: ['END'] }),
        valarm('20260927T120000Z', { VALUE: ['DATE-TIME'] }),
        valarm('PT10M'),
      ],
    }
    const component = draftComponent(draft({ reminders: [5] }), previous)
    expect(
      component.components.map((item) => [
        propertyValue(item, 'TRIGGER'),
        property(item, 'TRIGGER')?.params,
      ])
    ).toEqual([
      ['-PT30M', { RELATED: ['END'] }],
      ['20260927T120000Z', { VALUE: ['DATE-TIME'] }],
      ['PT10M', {}],
      ['-PT5M', {}],
    ])
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
    const component = draftComponent(draft({ reminders: [] }), previous)
    expect(propertyValue(component, 'SUMMARY')).toBe('Standup')
    expect(propertyValue(component, 'TRANSP')).toBe('TRANSPARENT')
    expect(propertyValue(component, 'CLASS')).toBe('PRIVATE')
    expect(component.components.map((item) => item.name)).toEqual(['VOTHER'])
  })
})

describe('tentative', () => {
  function event(status?: string): Component {
    const component = draftComponent(draft())
    if (status) {
      component.properties.push({ name: 'STATUS', params: {}, value: status })
    }
    return component
  }

  function statuses(component: Component): string[] {
    return component.properties
      .filter((item) => item.name === 'STATUS')
      .map((item) => item.value)
  }

  it('reads an event as tentative only when its status says so', () => {
    expect(componentDraft(event('TENTATIVE'), 'cal1', ZONE).tentative).toBe(
      true
    )
    expect(componentDraft(event('CONFIRMED'), 'cal1', ZONE).tentative).toBe(
      false
    )
    expect(componentDraft(event(), 'cal1', ZONE).tentative).toBe(false)
  })

  it('writes the status once when set, in place of any other', () => {
    const on = draft({ tentative: true })
    expect(statuses(draftComponent(on))).toEqual(['TENTATIVE'])
    expect(statuses(draftComponent(on, event('CONFIRMED')))).toEqual([
      'TENTATIVE',
    ])
    expect(statuses(draftComponent(on, event('TENTATIVE')))).toEqual([
      'TENTATIVE',
    ])
  })

  it('clears it when turned off, leaving a confirmed or cancelled status alone', () => {
    const off = draft({ tentative: false })
    expect(statuses(draftComponent(off, event('TENTATIVE')))).toEqual([])
    expect(statuses(draftComponent(off, event('CANCELLED')))).toEqual([
      'CANCELLED',
    ])
    expect(statuses(draftComponent(off, event('CONFIRMED')))).toEqual([
      'CONFIRMED',
    ])
    expect(statuses(draftComponent(off))).toEqual([])
  })

  it('keeps the status of an event whose draft says nothing of it', () => {
    const silent = draft({ tentative: undefined })
    expect(statuses(draftComponent(silent, event('TENTATIVE')))).toEqual([
      'TENTATIVE',
    ])
    expect(statuses(draftComponent(silent, event('CANCELLED')))).toEqual([
      'CANCELLED',
    ])
  })
})

describe('componentDraft', () => {
  it('reads every alarm the reminder setting can say, once each', () => {
    const component = draftComponent(draft({ reminders: [] }))
    component.components = [
      valarm('-PT15M', { RELATED: ['END'] }),
      valarm('-PT30M'),
      valarm('-P1D'),
      valarm('-PT30M'),
    ]
    expect(componentDraft(component, 'cal1', 'UTC').reminders).toEqual([
      30, 1440,
    ])
    component.components = [valarm('-PT15M', { RELATED: ['END'] })]
    expect(componentDraft(component, 'cal1', 'UTC').reminders).toEqual([])
  })

  it('reads a timed event back into the same draft', () => {
    const original = draft({
      location: 'Room 1',
      description: 'Notes',
      original: 'Notes',
    })
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

  describe('an event written with a DURATION in place of a DTEND', () => {
    const lasting = (start: Property, duration: string): Component => ({
      name: 'VEVENT',
      properties: [
        { name: 'SUMMARY', params: {}, value: 'Standup' },
        start,
        { name: 'DURATION', params: {}, value: duration },
      ],
      components: [],
    })
    const at = (value: string): Property => ({
      name: 'DTSTART',
      params: { TZID: [ZONE] },
      value,
    })

    it('ends that long after it starts', () => {
      const read = componentDraft(
        lasting(at('20260916T090000'), 'PT1H30M'),
        'cal1',
        ZONE
      )
      expect(read.finish).toBe('2026-09-16')
      expect(read.finishTime).toBe(10 * 60 + 30)
      expect(read.zone.finish).toBe(ZONE)
    })

    it('counts a day as a calendar day across a change of clocks', () => {
      // London's clocks go back an hour early on 25 October 2026.
      const read = componentDraft(
        lasting(at('20261024T090000'), 'P1D'),
        'cal1',
        ZONE
      )
      expect(read.finish).toBe('2026-10-25')
      expect(read.finishTime).toBe(9 * 60)
    })

    it('covers whole days when it is all day', () => {
      const read = componentDraft(
        lasting(
          { name: 'DTSTART', params: { VALUE: ['DATE'] }, value: '20260916' },
          'P2D'
        ),
        'cal1',
        ZONE
      )
      expect(read.allday).toBe(true)
      expect(read.start).toBe('2026-09-16')
      expect(read.finish).toBe('2026-09-17')
    })

    it('keeps its length when saved, as a DTEND', () => {
      const stored = lasting(at('20260916T090000'), 'PT1H30M')
      const saved = draftComponent(componentDraft(stored, 'cal1', ZONE), stored)
      expect(propertyValue(saved, 'DTEND')).toBe('20260916T103000')
      expect(property(saved, 'DURATION')).toBeUndefined()
    })
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

// The tests run on Node, whose zone data names zones as Chrome does:
// Asia/Calcutta for Asia/Kolkata.
describe('one zone under two names', () => {
  it('keeps the end following the start while the two agree under any names', () => {
    expect(
      startZone(
        { start: 'Asia/Calcutta', finish: 'Asia/Kolkata' },
        'Asia/Tokyo'
      )
    ).toEqual({ start: 'Asia/Tokyo', finish: 'Asia/Tokyo' })
    expect(
      startZone({ start: 'Asia/Calcutta', finish: 'Europe/Kyiv' }, 'Asia/Tokyo')
    ).toEqual({ start: 'Asia/Tokyo', finish: 'Europe/Kyiv' })
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

describe('opening an occurrence of a series', () => {
  const daily = { ...emptyRepeat(), frequency: 'daily' as const }
  const series = draftComponent(draft({ repeat: daily }))
  const at = (value: string) =>
    propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
      .seconds
  // The third occurrence, 2026-09-18 09:00 London.
  const third = at('20260918T090000')
  const opened = () => openedDraft([series], third, 'cal1', ZONE, true)!

  it('reads a plain occurrence on its own day', () => {
    const read = opened()
    expect(read.start).toBe('2026-09-18')
    expect(read.startTime).toBe(9 * 60)
    expect(read.finish).toBe('2026-09-18')
    expect(read.repeat.frequency).toBe('daily')
  })

  it('reads an occurrence that has an override from the override', () => {
    const changed = editedComponents(
      [series],
      draft({
        title: 'Once',
        start: '2026-09-18',
        startTime: 14 * 60,
        finish: '2026-09-18',
        finishTime: 15 * 60,
      }),
      'one',
      third,
      ZONE
    )
    const read = openedDraft(changed, third, 'cal1', ZONE, true)!
    expect(read.title).toBe('Once')
    expect(read.start).toBe('2026-09-18')
    expect(read.startTime).toBe(14 * 60)
  })

  it('reads an event that does not repeat as it is', () => {
    const single = draftComponent(draft())
    const read = openedDraft([single], third, 'cal1', ZONE, false)!
    expect(read.start).toBe('2026-09-16')
    expect(read.startTime).toBe(9 * 60)
  })

  it('writes "This event" on the occurrence\'s own day', () => {
    const written = savedComponents(
      [series],
      { ...opened(), title: 'Renamed' },
      'one',
      third,
      ZONE
    )
    expect(written[0]).toBe(series)
    const override = written[1]
    expect(propertyValue(override, 'SUMMARY')).toBe('Renamed')
    expect(propertyValue(override, 'DTSTART')).toBe('20260918T090000')
    expect(propertyValue(override, 'DTEND')).toBe('20260918T100000')
    expect(propertyValue(override, 'RECURRENCE-ID')).toBe('20260918T090000')
  })

  it('keeps the series start when "All events" changes only the title', () => {
    const written = savedComponents(
      [series],
      { ...opened(), title: 'Renamed' },
      'all',
      third,
      ZONE
    )
    expect(written).toHaveLength(1)
    expect(propertyValue(written[0], 'SUMMARY')).toBe('Renamed')
    expect(propertyValue(written[0], 'DTSTART')).toBe('20260916T090000')
    expect(propertyValue(written[0], 'RRULE')).toBe('FREQ=DAILY')
  })

  it('moves every occurrence when "All events" changes the time', () => {
    const written = savedComponents(
      [series],
      { ...opened(), startTime: 11 * 60, finishTime: 12 * 60 },
      'all',
      third,
      ZONE
    )
    expect(propertyValue(written[0], 'DTSTART')).toBe('20260916T110000')
    expect(propertyValue(written[0], 'DTEND')).toBe('20260916T120000')
  })

  it('splits "This and following" at the occurrence', () => {
    const split = splitSeries([series], opened(), third, ZONE)!
    expect(propertyValue(split.after[0], 'DTSTART')).toBe('20260918T090000')
    expect(propertyValue(split.before[0], 'RRULE')).toBe(
      'FREQ=DAILY;UNTIL=20260918T075959Z'
    )
  })
})

describe('saving a changed occurrence', () => {
  const daily = { ...emptyRepeat(), frequency: 'daily' as const }
  const series = draftComponent(draft({ repeat: daily }))
  const at = (value: string) =>
    propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
      .seconds
  const third = at('20260918T090000')
  // The 18th renamed and moved to 14:00, and the 20th renamed.
  const changed = editedComponents(
    editedComponents(
      [series],
      draft({
        title: 'Once',
        start: '2026-09-18',
        startTime: 14 * 60,
        finish: '2026-09-18',
        finishTime: 15 * 60,
      }),
      'one',
      third,
      ZONE
    ),
    draft({ title: 'Later', start: '2026-09-20', finish: '2026-09-20' }),
    'one',
    at('20260920T090000'),
    ZONE
  )
  // The 18th opened in the editor and given a location.
  const edited = () => ({
    ...openedDraft(changed, third, 'cal1', ZONE, true)!,
    location: 'Room 2',
  })
  const summaries = (list: Component[]) =>
    list.map((item) => propertyValue(item, 'SUMMARY'))

  it("opens on the override's own values with the series' rule", () => {
    const read = openedDraft(changed, third, 'cal1', ZONE, true)!
    expect(read.title).toBe('Once')
    expect(read.startTime).toBe(14 * 60)
    expect(read.repeat.frequency).toBe('daily')
  })

  it('writes "This event" as the override, with no rule', () => {
    const written = savedComponents(changed, edited(), 'one', third, ZONE)
    expect(propertyValue(written[0], 'RRULE')).toBe('FREQ=DAILY')
    const override = written[written.length - 1]
    expect(propertyValue(override, 'LOCATION')).toBe('Room 2')
    expect(propertyValue(override, 'DTSTART')).toBe('20260918T140000')
    expect(propertyValue(override, 'RECURRENCE-ID')).toBe('20260918T090000')
    expect(property(override, 'RRULE')).toBeUndefined()
  })

  it('makes "All events" the form as shown, measured from the occurrence\'s place', () => {
    const written = savedComponents(changed, edited(), 'all', third, ZONE)
    const master = written[0]
    expect(propertyValue(master, 'RRULE')).toBe('FREQ=DAILY')
    expect(propertyValue(master, 'DTSTART')).toBe('20260916T140000')
    expect(propertyValue(master, 'SUMMARY')).toBe('Once')
    expect(propertyValue(master, 'LOCATION')).toBe('Room 2')
    // The 18th's override is what the form replaced; the 20th's stays,
    // moved the five hours the series moved.
    expect(summaries(written)).toEqual(['Once', 'Later'])
    expect(propertyValue(written[1], 'RECURRENCE-ID')).toBe('20260920T140000')
  })

  it('starts "This and following" from the form, still repeating, without the old override', () => {
    const split = savedSplit(changed, edited(), third, ZONE)!
    expect(propertyValue(split.before[0], 'RRULE')).toBe(
      'FREQ=DAILY;UNTIL=20260918T075959Z'
    )
    const head = split.after[0]
    expect(propertyValue(head, 'RRULE')).toBe('FREQ=DAILY')
    expect(propertyValue(head, 'DTSTART')).toBe('20260918T140000')
    expect(propertyValue(head, 'LOCATION')).toBe('Room 2')
    expect(summaries(split.after)).toEqual(['Once', 'Later'])
    expect(propertyValue(split.after[1], 'RECURRENCE-ID')).toBe(
      '20260920T140000'
    )
  })

  it("carries a dragged occurrence's override along, since a drag starts from the master", () => {
    const dragged = movedDraft(
      occurrenceDraft(series, third, 'cal1', ZONE),
      3600
    )
    const split = splitSeries(changed, dragged, third, ZONE)!
    expect(summaries(split.after)).toEqual(['Standup', 'Once', 'Later'])
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

describe('a rich copy of the description another client keeps', () => {
  const stored: Component = (() => {
    const component = draftComponent(draft())
    return {
      ...component,
      properties: [
        ...component.properties,
        { name: 'DESCRIPTION', params: {}, value: 'Gate 12' },
        {
          name: 'X-ALT-DESC',
          params: { FMTTYPE: ['text/html'] },
          value: '<p>Gate <b>12</b></p>',
        },
      ],
    }
  })()

  it('stays while the description is unchanged', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent({ ...read, title: 'Flight' }, stored)
    expect(propertyValue(saved, 'X-ALT-DESC')).toBe('<p>Gate <b>12</b></p>')
  })

  it('goes once the description is edited, so it cannot show the old text', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent({ ...read, description: 'Gate 14' }, stored)
    expect(propertyValue(saved, 'DESCRIPTION')).toBe('Gate 14')
    expect(property(saved, 'X-ALT-DESC')).toBeUndefined()
  })

  it('goes with a cleared description', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent({ ...read, description: '' }, stored)
    expect(property(saved, 'X-ALT-DESC')).toBeUndefined()
  })
})

describe('a description written as HTML', () => {
  const html = 'PNR: 2YHEIJ<br>Class: <b>Business</b> &amp; lounge'
  const text = 'PNR: 2YHEIJ\nClass: Business & lounge'
  const described = (component: Component): Component => ({
    ...component,
    properties: [
      ...component.properties,
      { name: 'DESCRIPTION', params: {}, value: html },
    ],
  })
  const stored = described(draftComponent(draft()))

  it('opens in the editor as its text', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    expect(read.description).toBe(text)
    expect(read.original).toBe(html)
  })

  it('keeps its markup through a save that changed something else', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent({ ...read, title: 'Flight' }, stored)
    expect(propertyValue(saved, 'DESCRIPTION')).toBe(html)
  })

  it('is saved as the text typed once edited', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent(
      { ...read, description: `${read.description}\nSeat 2A` },
      stored
    )
    expect(propertyValue(saved, 'DESCRIPTION')).toBe(`${text}\nSeat 2A`)
  })

  it('is dropped when its text is cleared', () => {
    const read = componentDraft(stored, 'cal1', 'UTC')
    const saved = draftComponent({ ...read, description: '' }, stored)
    expect(property(saved, 'DESCRIPTION')).toBeUndefined()
  })

  it("keeps its markup on one occurrence's override", () => {
    const series = described(
      draftComponent(
        draft({ repeat: { ...emptyRepeat(), frequency: 'daily' } })
      )
    )
    const second = propertyInstant(
      { name: 'DTSTART', params: { TZID: [ZONE] }, value: '20260917T090000' },
      ZONE
    )!.seconds
    const read = occurrenceDraft(series, second, 'cal1', ZONE)
    const [, override] = editedComponents(
      [series],
      { ...read, title: 'Moved' },
      'one',
      second,
      ZONE
    )
    expect(propertyValue(override, 'DESCRIPTION')).toBe(html)
  })

  it('keeps its markup in a copy, which has no stored event to fall back on', () => {
    const copied = copyDraft([stored], 0, 'cal2', ZONE, 'all')!
    expect(copied.description).toBe(text)
    expect(propertyValue(draftComponent(copied), 'DESCRIPTION')).toBe(html)
  })

  it('opens as text in a copy of a listed occurrence, and keeps its markup', () => {
    const start = Date.UTC(2026, 8, 25, 9) / 1000
    const copied = instanceDraft(
      {
        summary: 'Flight',
        location: '',
        description: html,
        start,
        finish: start + 3600,
        allday: false,
      },
      'cal1',
      15,
      'UTC'
    )
    expect(copied.description).toBe(text)
    expect(propertyValue(draftComponent(copied), 'DESCRIPTION')).toBe(html)
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

  it('copies a one-off event as the form reads, edits and all', () => {
    const single = draftComponent(draft())
    const form = draft({ title: 'Edited', location: 'Room 9' })
    const copied = formCopy(form, [single], 0, ZONE, 'one', false)
    expect(copied.title).toBe('Edited')
    expect(copied.location).toBe('Room 9')
  })

  // The form as the editor opens the third occurrence, then edited.
  const opened = (components: Component[], title: string) => ({
    ...openedDraft(components, third, 'cal1', ZONE, true)!,
    title,
  })

  it('copies the edited form on its own day for "This event"', () => {
    const copied = formCopy(
      opened([series], 'Edited'),
      [series],
      third,
      ZONE,
      'one',
      true
    )
    expect(copied.title).toBe('Edited')
    expect(copied.start).toBe('2026-09-18')
    expect(copied.startTime).toBe(9 * 60)
    expect(copied.repeat.frequency).toBe('never')
  })

  it('moves the edited form back to the series start for "All events"', () => {
    const copied = formCopy(
      opened([series], 'Edited'),
      [series],
      third,
      ZONE,
      'all',
      true
    )
    expect(copied.title).toBe('Edited')
    expect(copied.start).toBe('2026-09-16')
    expect(copied.startTime).toBe(9 * 60)
    expect(copied.repeat.frequency).toBe('daily')
  })

  it('copies the edited form for "All events" from an override too', () => {
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
    const copied = formCopy(
      opened(edited, 'Changed again'),
      edited,
      third,
      ZONE,
      'all',
      true
    )
    // Moved as a save of "All events" would move it: to the series' first
    // day, at the time the form shows.
    expect(copied.title).toBe('Changed again')
    expect(copied.start).toBe('2026-09-16')
    expect(copied.startTime).toBe(11 * 60)
    expect(copied.repeat.frequency).toBe('daily')
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
    expect(copied.reminders).toEqual([15])
    expect(copied.repeat.frequency).toBe('never')
  })

  describe('a listed occurrence written in zones of its own', () => {
    // Leaves New York at 18:00 and lands in London at 07:00 the next day.
    const start = Date.UTC(2026, 8, 25, 22) / 1000
    const flight = (zone: { start: string; finish: string }) =>
      instanceDraft(
        {
          summary: 'Flight',
          location: 'JFK',
          description: '',
          start,
          finish: start + 8 * 3600,
          allday: false,
          zone,
        },
        'cal1',
        15,
        'Asia/Tokyo'
      )

    it('keeps each end in its own zone, not the user zone', () => {
      const copied = flight({
        start: 'America/New_York',
        finish: 'Europe/London',
      })
      expect(copied.zone).toEqual({
        start: 'America/New_York',
        finish: 'Europe/London',
      })
      expect(copied.start).toBe('2026-09-25')
      expect(copied.startTime).toBe(18 * 60)
      expect(copied.finish).toBe('2026-09-26')
      expect(copied.finishTime).toBe(7 * 60)
    })

    it('ends in the start zone when the end names none', () => {
      const copied = flight({ start: 'America/New_York', finish: '' })
      expect(copied.zone).toEqual({
        start: 'America/New_York',
        finish: 'America/New_York',
      })
      expect(copied.finish).toBe('2026-09-26')
      expect(copied.finishTime).toBe(2 * 60)
    })

    it('reads ends written in UTC in the user zone', () => {
      const copied = flight({ start: '', finish: '' })
      expect(copied.zone).toEqual({
        start: 'Asia/Tokyo',
        finish: 'Asia/Tokyo',
      })
      expect(copied.start).toBe('2026-09-26')
      expect(copied.startTime).toBe(7 * 60)
    })
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
    expect(copied.reminders).toEqual([])
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
      user: 'UTC',
    })
    // 09:00 UTC is 18:00 in Tokyo, the same instant.
    expect(draft.start).toBe('2026-09-25')
    expect(draft.startTime).toBe(18 * 60)
    expect(draft.finishTime).toBe(19 * 60)
    expect(draft.zone).toEqual({ start: 'Asia/Tokyo', finish: 'Asia/Tokyo' })
    expect(draftInstants(draft)).toEqual({ start: nine, finish: nine + 3600 })
    expect(draft.calendar).toBe('cal1')
    expect(draft.reminders).toEqual([15])
    expect(draft.title).toBe('')
    expect(draft.repeat.frequency).toBe('never')
  })

  it('takes the all-day switch it is given', () => {
    const draft = newDraft(nine, nine + 3600, {
      allday: true,
      calendar: 'cal1',
      reminder: -1,
      zone: { start: 'UTC', finish: 'UTC' },
      user: 'UTC',
    })
    expect(draft.allday).toBe(true)
    expect(draft.start).toBe('2026-09-25')
  })

  it("puts an all-day event on the day clicked in the user's zone, whatever zone was remembered", () => {
    // 08:00 on the 25th in Los Angeles is already the 26th in Tokyo.
    const eight = Date.UTC(2026, 8, 25, 15) / 1000
    const draft = newDraft(eight, eight + 3600, {
      allday: true,
      calendar: 'cal1',
      reminder: -1,
      zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' },
      user: 'America/Los_Angeles',
    })
    expect(draft.start).toBe('2026-09-25')
    expect(draft.finish).toBe('2026-09-25')
  })

  it('keeps a timed event in the remembered zone, at the same instant', () => {
    const eight = Date.UTC(2026, 8, 25, 15) / 1000
    const draft = newDraft(eight, eight + 3600, {
      allday: false,
      calendar: 'cal1',
      reminder: -1,
      zone: { start: 'Asia/Tokyo', finish: 'Asia/Tokyo' },
      user: 'America/Los_Angeles',
    })
    expect(draft.start).toBe('2026-09-26')
    expect(draft.startTime).toBe(0)
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

describe('when a new event starts', () => {
  const hours = { start: 8, finish: 17 }
  const today = '2026-09-28'

  it('starts today at the next whole hour', () => {
    expect(defaultStart(today, today, 14 * 60 + 37, hours)).toEqual({
      day: today,
      minutes: 15 * 60,
    })
    expect(defaultStart(today, today, 22 * 60 + 59, hours)).toEqual({
      day: today,
      minutes: 23 * 60,
    })
  })

  it('starts on another day at the start of the working hours', () => {
    expect(defaultStart('2026-10-02', today, 14 * 60 + 37, hours)).toEqual({
      day: '2026-10-02',
      minutes: 8 * 60,
    })
    expect(defaultStart('2026-10-02', today, 0, { start: 7 })).toEqual({
      day: '2026-10-02',
      minutes: 7 * 60,
    })
  })

  it("starts at tomorrow's working hours once today has no whole hour left", () => {
    expect(defaultStart(today, today, 23 * 60 + 10, hours)).toEqual({
      day: '2026-09-29',
      minutes: 8 * 60,
    })
  })

  it('lands on today when today is on screen, else on the day the view is on', () => {
    // A week from Monday the 28th, today inside it.
    expect(creationDay(today, '2026-09-30', '2026-09-28', 7)).toBe(today)
    // The next week, paged to.
    expect(creationDay(today, '2026-10-07', '2026-10-05', 7)).toBe('2026-10-07')
    // A day view of tomorrow.
    expect(creationDay(today, '2026-09-29', '2026-09-29', 1)).toBe('2026-09-29')
    // The week before.
    expect(creationDay(today, '2026-09-23', '2026-09-21', 7)).toBe('2026-09-23')
  })
})

describe('the calendar a new event goes in', () => {
  // The built-in default is not first, as nothing orders it so.
  const calendars = [
    { id: 'work', readonly: false, default: false },
    { id: 'birthdays', readonly: true, default: false },
    { id: 'standard', readonly: false, default: true },
    { id: 'google', readonly: true, default: false },
  ]

  it('is the one the preferences name', () => {
    expect(defaultCalendar(calendars, 'work')).toBe('work')
  })

  it('is the built-in default when none is named, or the one named is gone or read-only', () => {
    expect(defaultCalendar(calendars, '')).toBe('standard')
    expect(defaultCalendar(calendars, 'deleted')).toBe('standard')
    expect(defaultCalendar(calendars, 'google')).toBe('standard')
    expect(defaultCalendar(calendars, 'birthdays')).toBe('standard')
  })

  it('is the first the user can write to without a built-in default, and none without one at all', () => {
    expect(
      defaultCalendar(
        calendars.filter((calendar) => !calendar.default),
        ''
      )
    ).toBe('work')
    expect(
      defaultCalendar(
        calendars.filter((calendar) => calendar.readonly),
        ''
      )
    ).toBe('')
  })
})

describe('moving the start in the editor', () => {
  it('keeps the length when the end is pushed past midnight', () => {
    const moved = shiftedStart(
      draft({
        start: '2026-09-16',
        startTime: 22 * 60,
        finish: '2026-09-16',
        finishTime: 23 * 60,
      }),
      '2026-09-16',
      23 * 60 + 30
    )
    expect(moved.finish).toBe('2026-09-17')
    expect(moved.finishTime).toBe(30)
  })

  it('brings an end past midnight back a day when the start moves earlier', () => {
    const moved = shiftedStart(
      draft({
        start: '2026-09-16',
        startTime: 23 * 60,
        finish: '2026-09-17',
        finishTime: 30,
      }),
      '2026-09-16',
      22 * 60
    )
    expect(moved.finish).toBe('2026-09-16')
    expect(moved.finishTime).toBe(23 * 60 + 30)
  })

  it('moves the end by as many days as the start', () => {
    const moved = shiftedStart(
      draft({
        start: '2026-09-16',
        startTime: 9 * 60,
        finish: '2026-09-16',
        finishTime: 10 * 60,
      }),
      '2026-09-18',
      9 * 60
    )
    expect(moved.finish).toBe('2026-09-18')
    expect(moved.finishTime).toBe(10 * 60)
  })
})
