// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { timestampAt } from '@mochi/web'
import { describe, expect, it } from 'vitest'
import type { Instance } from '@/api/types/events'
import { emptyRepeat, type EventDraft } from './ical'
import { blocks, LAST, moved, placed, resized, stripped } from './strip'

const LONDON = 'Europe/London'
const nine = 9 * 60

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Standup',
    calendar: 'cal1',
    allday: false,
    start: '2026-09-30',
    startTime: nine,
    finish: '2026-09-30',
    finishTime: nine + 60,
    zone: { start: LONDON, finish: LONDON },
    location: '',
    description: '',
    original: '',
    repeat: emptyRepeat(),
    reminders: [],
    ...overrides,
  }
}

function instance(overrides: Partial<Instance>): Instance {
  return {
    event: 'e1',
    calendar: 'cal1',
    colour: '#60a5fa',
    readonly: false,
    uid: 'u1',
    component: 'VEVENT',
    summary: 'Lunch',
    location: '',
    description: '',
    status: '',
    start: 0,
    finish: 0,
    allday: false,
    recurring: false,
    ...overrides,
  }
}

describe('when the day strip shows', () => {
  it('shows for a timed event on one day in one zone', () => {
    expect(stripped(draft())).toBe(true)
  })

  it('leaves an all-day event, one over several days, and a flight across zones to the fields', () => {
    expect(stripped(draft({ allday: true }))).toBe(false)
    expect(stripped(draft({ finish: '2026-10-01' }))).toBe(false)
    expect(
      stripped(draft({ zone: { start: LONDON, finish: 'America/New_York' } }))
    ).toBe(false)
  })

  it('counts one zone under two names as one', () => {
    expect(
      stripped(
        draft({ zone: { start: 'Asia/Calcutta', finish: 'Asia/Kolkata' } })
      )
    ).toBe(true)
  })
})

describe('dragging and clicking on the strip', () => {
  it('moves the event by whole steps, keeping its length', () => {
    expect(moved(nine, nine + 60, 32)).toEqual({
      start: nine + 30,
      finish: nine + 90,
    })
    expect(moved(nine, nine + 60, -17)).toEqual({
      start: nine - 15,
      finish: nine + 45,
    })
    // A start off the steps lands on one.
    expect(moved(nine + 3, nine + 63, 0)).toEqual({
      start: nine + 5,
      finish: nine + 65,
    })
  })

  it('keeps the event within the day', () => {
    expect(moved(60, 120, -600)).toEqual({ start: 0, finish: 60 })
    expect(moved(22 * 60, 23 * 60, 600)).toEqual({
      start: LAST - 60,
      finish: LAST,
    })
  })

  it('stretches the end by whole steps, never to or before the start', () => {
    expect(resized(nine, nine + 60, 28)).toBe(nine + 90)
    expect(resized(nine, nine + 60, -120)).toBe(nine + 5)
    expect(resized(nine, nine + 60, 24 * 60)).toBe(LAST)
  })

  it('moves the event to the step a click falls in, keeping its length', () => {
    expect(placed(nine, nine + 60, 14 * 60 + 7.5)).toEqual({
      start: 14 * 60 + 5,
      finish: 15 * 60 + 5,
    })
    expect(placed(nine, nine + 60, 23 * 60 + 50)).toEqual({
      start: LAST - 60,
      finish: LAST,
    })
  })
})

describe("the day's other events", () => {
  const day = '2026-09-30'
  const from = timestampAt(day, 0, LONDON)
  const to = timestampAt('2026-10-01', 0, LONDON)
  const at = (minutes: number) => timestampAt(day, minutes, LONDON)

  it('places each timed event by its minutes of the day in the zone', () => {
    const lunch = instance({ start: at(12 * 60), finish: at(13 * 60 + 30) })
    expect(blocks([lunch], from, to, LONDON)).toEqual([
      {
        start: 12 * 60,
        finish: 13 * 60 + 30,
        summary: 'Lunch',
        colour: '#60a5fa',
      },
    ])
  })

  it('reads the minutes in the zone of the strip, not the viewer', () => {
    const lunch = instance({ start: at(12 * 60), finish: at(13 * 60) })
    const tokyo = blocks(
      [lunch],
      timestampAt(day, 0, 'Asia/Tokyo'),
      timestampAt('2026-10-01', 0, 'Asia/Tokyo'),
      'Asia/Tokyo'
    )
    expect(tokyo[0].start).toBe(20 * 60)
  })

  it('cuts an event running over midnight at the edges of the day', () => {
    const late = instance({ start: at(-60), finish: at(60) })
    const night = instance({ start: at(23 * 60), finish: at(25 * 60) })
    expect(
      blocks([late, night], from, to, LONDON).map((b) => [b.start, b.finish])
    ).toEqual([
      [0, 60],
      [23 * 60, 24 * 60],
    ])
  })

  it('leaves out all-day events, events on other days, and the one being edited', () => {
    const listed = [
      instance({ allday: true, start: from, finish: to }),
      instance({ start: at(-3 * 60), finish: at(-2 * 60) }),
      instance({ event: 'e2', start: at(nine), finish: at(nine + 60) }),
      instance({ event: 'e3', start: at(nine), finish: at(nine + 30) }),
      // Another occurrence of the event being edited stays.
      instance({ event: 'e2', start: at(18 * 60), finish: at(18 * 60 + 45) }),
    ]
    expect(
      blocks(listed, from, to, LONDON, { event: 'e2', start: at(nine) }).map(
        (b) => b.finish - b.start
      )
    ).toEqual([30, 45])
  })
})
