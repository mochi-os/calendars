// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { LocaleProvider } from '@mochi/web'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { Instance } from '@/api/types/events'
import { Agenda } from './agenda'

const calendar = { id: 'c1', name: 'Test calendar', colour: '#60a5fa' }

// What the list is given and what it asked for, per test.
const state = vi.hoisted(() => ({
  search: '',
  date: '2026-09-22',
  first: 0,
  failed: false,
  retry: vi.fn(),
  pages: [] as { start: number; finish: number }[],
}))

beforeEach(() => {
  state.search = ''
  state.date = '2026-09-22'
  state.first = 0
  state.failed = false
  state.retry.mockReset()
  state.pages = []
})

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    preferences: { zones: false },
    search: state.search,
    date: state.date,
    today: '2026-09-22',
    calendars: [calendar],
    visible: [calendar],
  }),
}))

// Noon UTC keeps the occurrence on its date in any zone the test runs in.
const noon = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day, 12) / 1000

const instance = (day: number, summary: string): Instance => ({
  event: `e${day}`,
  calendar: calendar.id,
  colour: calendar.colour,
  readonly: false,
  uid: `u${day}`,
  component: 'VEVENT',
  summary,
  location: '',
  description: '',
  status: '',
  start: noon(2026, 9, day),
  finish: noon(2026, 9, day) + 3600,
  allday: false,
  recurring: false,
})

vi.mock('@/hooks/use-events', () => ({
  useBoundsQuery: () => ({
    data: { first: state.first, last: 0, endless: false },
  }),
  useInstancePages: (pages: { start: number; finish: number }[]) => {
    state.pages = pages
    return {
    instances: [
      instance(22, 'Design review'),
      // An all-day occurrence whose instants come before the next day's
      // events, as midnight UTC does in a zone behind UTC: its date is the
      // 24th, after the 23rd's.
      {
        ...instance(24, 'Holiday'),
        allday: true,
        date: '2026-09-24',
        start: Date.UTC(2026, 8, 23, 0) / 1000,
        finish: Date.UTC(2026, 8, 24, 0) / 1000,
      },
      { ...instance(23, 'Wax boots'), recurring: true, alarm: true },
      { ...instance(24, 'Called off'), status: 'CANCELLED' },
      { ...instance(24, ''), event: 'e24b', start: noon(2026, 9, 24) + 60 },
      // From noon one day to noon the next: across days in any zone.
      {
        ...instance(25, 'Overnight'),
        finish: noon(2026, 9, 26),
      },
      // An early swim, and an all-day occurrence the same day expanded by a
      // server ten hours behind UTC, whose instants begin after the swim's.
      {
        ...instance(25, 'Early swim'),
        start: Date.UTC(2026, 8, 25, 6) / 1000,
        finish: Date.UTC(2026, 8, 25, 7) / 1000,
      },
      {
        ...instance(25, 'Market day'),
        allday: true,
        date: '2026-09-25',
        start: Date.UTC(2026, 8, 25, 10) / 1000,
        finish: Date.UTC(2026, 8, 26, 10) / 1000,
      },
      // Another that day, from the same instant: they go by title.
      {
        ...instance(25, 'Bin day'),
        event: 'e25b',
        allday: true,
        date: '2026-09-25',
        start: Date.UTC(2026, 8, 25, 10) / 1000,
        finish: Date.UTC(2026, 8, 26, 10) / 1000,
      },
      // An all-day occurrence expanded by a server nine hours ahead of this
      // browser's UTC: its instants begin on the 21st, its date is the 22nd.
      {
        ...instance(22, 'Laundry'),
        allday: true,
        date: '2026-09-22',
        start: Date.UTC(2026, 8, 21, 15) / 1000,
        finish: Date.UTC(2026, 8, 22, 15) / 1000,
      },
    ],
    pending: false,
    failed: state.failed,
    retry: state.retry,
    }
  },
}))

function show(selected?: string) {
  render(
    <I18nProvider i18n={i18n}>
      <Agenda selected={selected} onSelect={vi.fn()} />
    </I18nProvider>
  )
  const headings = screen.getAllByRole('heading', { level: 2 })
  const of = (day: number) =>
    headings.find((heading) =>
      new RegExp(`\\b${day}\\b`).test(heading.textContent ?? '')
    ) as HTMLElement
  return { today: of(22), other: of(23) }
}

describe('Agenda search', () => {
  it('says a search matched nothing, rather than that there are no events', () => {
    state.search = 'dentist'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.queryByText('No events')).toBeNull()
  })

  it('lists what a search matched', () => {
    state.search = 'boots'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByText('Wax boots')).toBeInTheDocument()
    expect(screen.queryByText('No matches')).toBeNull()
  })
})

describe('Agenda top', () => {
  it('tells the day atop the list as it scrolls, once for each day', () => {
    const onTop = vi.fn()
    // Where each day's rows end, below the top of the list.
    const ends: Record<string, number> = {
      '2026-09-22': 40,
      '2026-09-23': 80,
      '2026-09-24': 120,
    }
    const measured = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const day = (this as HTMLElement).dataset?.day
        const bottom = day ? (ends[day] ?? 0) : 0
        return { top: 0, bottom, left: 0, right: 0, width: 0, height: bottom, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      })
    try {
      render(
        <I18nProvider i18n={i18n}>
          <Agenda onSelect={vi.fn()} onTop={onTop} />
        </I18nProvider>
      )
      expect(onTop).toHaveBeenLastCalledWith('2026-09-22')
      // Scrolled past the 22nd and to the foot of the 23rd.
      Object.assign(ends, { '2026-09-22': -40, '2026-09-23': 0, '2026-09-24': 30 })
      const list = screen
        .getAllByRole('heading', { level: 2 })[0]
        .closest('.overflow-y-auto') as HTMLElement
      fireEvent.scroll(list)
      expect(onTop).toHaveBeenLastCalledWith('2026-09-24')
      const told = onTop.mock.calls.length
      ends['2026-09-24'] = 20
      fireEvent.scroll(list)
      expect(onTop).toHaveBeenCalledTimes(told)
    } finally {
      measured.mockRestore()
    }
  })

  it('tells the day atop the list afresh under a new anchor, though it is the same day', () => {
    const onTop = vi.fn()
    const measured = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        const bottom = (this as HTMLElement).dataset?.day === '2026-09-22' ? 40 : 0
        return { top: 0, bottom, left: 0, right: 0, width: 0, height: bottom, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      })
    try {
      const view = () => (
        <I18nProvider i18n={i18n}>
          <Agenda onSelect={vi.fn()} onTop={onTop} />
        </I18nProvider>
      )
      const { rerender } = render(view())
      expect(onTop).toHaveBeenCalledTimes(1)
      state.date = '2026-09-20'
      rerender(view())
      expect(onTop).toHaveBeenCalledTimes(2)
      expect(onTop).toHaveBeenLastCalledWith('2026-09-22')
    } finally {
      measured.mockRestore()
    }
  })
})

describe('Agenda opened day', () => {
  const headings = () =>
    screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent ?? '')

  it('heads the day it opened on even when nothing is on it, with no rows beneath', () => {
    state.date = '2026-09-21'
    show()
    expect(headings()[0]).toBe('2026-09-21 Mon')
    const day = screen
      .getAllByRole('heading', { level: 2 })[0]
      .closest('[data-day]') as HTMLElement
    expect(day.querySelectorAll('li')).toHaveLength(0)
    expect(day.textContent).toBe('2026-09-21 Mon')
  })

  it('leaves the empty day out of a search, which lists only its matches', () => {
    state.date = '2026-09-21'
    state.search = 'boots'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(headings().some((day) => day.startsWith('2026-09-21'))).toBe(false)
  })
})

describe('Agenda order', () => {
  it('lists the days in date order, whatever order their instants arrive in', () => {
    show()
    const days = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent ?? '')
    expect(days.some((day) => day.startsWith('2026-09-23'))).toBe(true)
    expect(days.some((day) => day.startsWith('2026-09-24'))).toBe(true)
    expect(days).toEqual([...days].sort())
  })

  it("puts a day's all-day occurrences before its timed ones", () => {
    show()
    const row = (summary: string) =>
      screen.getByText(summary).closest('button') as HTMLElement
    const before = (first: string, second: string) =>
      row(first).compareDocumentPosition(row(second)) &
      Node.DOCUMENT_POSITION_FOLLOWING
    expect(before('Laundry', 'Design review')).toBeTruthy()
    expect(before('Holiday', 'Called off')).toBeTruthy()
    // Even one whose instants begin after a timed one's that day.
    expect(before('Market day', 'Early swim')).toBeTruthy()
    // Two from the same instant go by title.
    expect(before('Bin day', 'Market day')).toBeTruthy()
  })
})

describe('Agenda day headings', () => {
  it('leads with a year-first date and puts the short weekday after it', () => {
    // Without a LocaleProvider the date format is the ISO default.
    const { today, other } = show()
    expect(today.textContent).toBe('2026-09-22 Tue')
    expect(other.textContent).toBe('2026-09-23 Wed')
  })

  it('puts the short weekday first, in the order the language puts them, under any other date format', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          locale: {
            date_format: 'DD/MM/YYYY',
            time_format: 'auto',
            timestamp_display: 'auto',
            week_start: 'auto',
            number_format: 'auto',
            units: 'auto',
            timezone: 'auto',
          },
        }),
      }))
    )
    try {
      render(
        <I18nProvider i18n={i18n}>
          <LocaleProvider>
            <Agenda onSelect={vi.fn()} />
          </LocaleProvider>
        </I18nProvider>
      )
      expect(
        await screen.findByRole('heading', { level: 2, name: 'Tue, 22/09/2026' })
      ).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the brackets a language puts round the weekday after a year-first date', () => {
    const catalogue = readFileSync(
      resolve(__dirname, '../../../locales/ja/messages.po'),
      'utf8'
    )
    const value = catalogue.match(
      /msgctxt "ISO date"\nmsgid "\{date\} \{weekday\}"\nmsgstr "(.*)"/
    )?.[1]
    expect(value).toBe('{date}({weekday})')
    // The id Lingui gives a message: its source and context, hashed.
    const id = createHash('sha256')
      .update('{date} {weekday}\u001fISO date')
      .digest('base64')
      .slice(0, 6)
    const previous = i18n.locale
    i18n.load('ja', { [id]: value! })
    i18n.activate('ja')
    try {
      const { today } = show()
      expect(today.textContent).toBe('2026-09-22(火)')
    } finally {
      i18n.activate(previous)
    }
  })
})

describe('Agenda', () => {

  it("fills today's heading in the primary colour with contrasting text", () => {
    const { today } = show()
    expect(today.classList.contains('bg-primary')).toBe(true)
    expect(today.classList.contains('text-primary-foreground')).toBe(true)
  })

  it('leaves the other headings on the muted band', () => {
    const { other } = show()
    expect(other.classList.contains('bg-primary')).toBe(false)
    expect(other.classList.contains('bg-muted/60')).toBe(true)
  })
})

describe('Agenda all-day placement', () => {
  it('lists an all-day occurrence under its own date, not the day its instants begin', () => {
    show()
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(
      headings.some((heading) => /\b21\b/.test(heading.textContent ?? ''))
    ).toBe(false)
    const group = screen
      .getByText('Laundry')
      .closest('ul')?.previousElementSibling
    expect(group?.textContent).toMatch(/\b22\b/)
  })
})

describe('Agenda rows', () => {
  const row = (summary: string) =>
    screen.getByText(summary).closest('button') as HTMLElement

  it('reads a timed event as its dot, its title, then its time', () => {
    show()
    const review = row('Design review')
    expect(
      (review.firstElementChild as HTMLElement).classList.contains(
        'rounded-full'
      )
    ).toBe(true)
    const text = review.textContent ?? ''
    expect(text.indexOf('Design review')).toBeLessThan(
      text.search(/\d{1,2}:\d{2}/)
    )
  })

  it('gives a timed event its start and its end', () => {
    show()
    // An hour from noon UTC, in whatever zone the test runs in.
    const time = (row('Design review').textContent ?? '').match(
      /(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/
    )
    expect(time).not.toBeNull()
    const [, h1, m1, h2, m2] = time!.map(Number)
    expect((h2 * 60 + m2 - (h1 * 60 + m1) + 1440) % 1440).toBe(60)
  })

  it('writes each end of an event running into the next day as the headings write a day, on lines of their own', () => {
    show()
    const lines = (row('Overnight').children[2].textContent ?? '').split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^2026-09-25 Fri \d{2}:\d{2}\s–$/)
    expect(lines[1]).toMatch(/^2026-09-26 Sat \d{2}:\d{2}$/)
  })

  it('gives an all-day event no time', () => {
    show()
    const text = row('Laundry').textContent ?? ''
    expect(text).not.toMatch(/\d{1,2}:\d{2}/)
    // Nor a label standing in for one: the row is its dot and its title.
    expect(text).not.toMatch(/All day/)
  })

  it('draws an event that is over quieter than one still to come', () => {
    vi.useFakeTimers({
      now: new Date(Date.UTC(2026, 8, 22, 18)),
      toFake: ['Date'],
    })
    show()
    vi.useRealTimers()
    expect(row('Design review').classList.contains('opacity-60')).toBe(true)
    expect(row('Wax boots').classList.contains('opacity-60')).toBe(false)
  })

  it('puts the reminder and repeat marks in the rightmost column, each in a place of its own', () => {
    show()
    const marks = (summary: string) => {
      const cells = Array.from(row(summary).children) as HTMLElement[]
      return Array.from(cells[cells.length - 1].children).map(
        (slot) => slot.getAttribute('aria-label') ?? ''
      )
    }
    expect(marks('Wax boots')).toEqual(['Reminder', 'Repeats'])
    // No marks keeps both places, so the next row's marks line up.
    expect(marks('Design review')).toEqual(['', ''])
    const cells = Array.from(row('Wax boots').children) as HTMLElement[]
    expect(cells[2].textContent).toMatch(/^\d{1,2}:\d{2}/)
  })

  it('lays every row out in the same columns, so they line up down the list', () => {
    show()
    const rows = ['Design review', 'Wax boots', 'Overnight', 'Laundry'].map(
      row
    )
    const layout = (button: HTMLElement) =>
      [...button.classList].filter((name) => name.includes('grid-cols-'))
    for (const button of rows) {
      expect(button.classList.contains('grid')).toBe(true)
      expect(layout(button)).toEqual(layout(rows[0]))
      // Dot, title, time, location, calendar, marks: an all-day row keeps
      // its empty time cell, so the cells after it stay in their columns.
      expect(button.children).toHaveLength(6)
    }
    expect(layout(rows[0])).toContain(
      'md:grid-cols-[auto_minmax(0,2fr)_12rem_minmax(0,1fr)_10rem_auto]'
    )
  })
})

describe('Agenda event states', () => {
  const row = (text: string) =>
    screen.getByText(text).closest('button') as HTMLElement

  it('strikes through and quietens a cancelled event still to come', () => {
    vi.useFakeTimers({
      now: new Date(Date.UTC(2026, 8, 22, 18)),
      toFake: ['Date'],
    })
    show()
    vi.useRealTimers()
    expect(
      screen.getByText('Called off').classList.contains('line-through')
    ).toBe(true)
    expect(row('Called off').classList.contains('opacity-60')).toBe(true)
  })

  it('names an event with no title, quietly', () => {
    show()
    expect(
      screen.getByText('(No title)').classList.contains('text-muted-foreground')
    ).toBe(true)
  })

  it('tints the open event', () => {
    show(`e22:${noon(2026, 9, 22)}`)
    expect(row('Design review').classList.contains('bg-primary/10')).toBe(true)
    expect(row('Wax boots').classList.contains('bg-primary/10')).toBe(false)
  })
})

describe('Agenda states', () => {
  it('offers earlier events when the first is before 1970, such as a birthday', () => {
    state.first = -1_000_000_000
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByText('Earlier events')).toBeInTheDocument()
  })

  it('stops the earlier pages at 1970, which is as far back as the server lists', () => {
    state.first = -1_000_000_000
    state.date = '1970-02-01'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    fireEvent.click(screen.getByText('Earlier events'))
    expect(state.pages[0].start).toBe(0)
    expect(screen.queryByText('Earlier events')).toBeNull()
  })

  it('says a failed page failed, with a way to try again, rather than reading as empty', () => {
    state.failed = true
    state.search = 'nothing like this'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.queryByText('No events')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.retry).toHaveBeenCalledTimes(1)
  })
})
