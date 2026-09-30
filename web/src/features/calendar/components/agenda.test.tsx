// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
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
      { ...instance(23, 'Wax boots'), recurring: true, alarm: true },
      { ...instance(24, 'Called off'), status: 'CANCELLED' },
      { ...instance(24, ''), event: 'e24b', start: noon(2026, 9, 24) + 60 },
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

  it('puts the reminder and repeat marks just before the time', () => {
    show()
    const parts = Array.from(row('Wax boots').children) as HTMLElement[]
    const title = parts.findIndex((part) => part.textContent === 'Wax boots')
    const bell = parts.findIndex(
      (part) => part.getAttribute('aria-label') === 'Reminder'
    )
    const repeat = parts.findIndex(
      (part) => part.getAttribute('aria-label') === 'Repeats'
    )
    expect(title).toBeLessThan(bell)
    expect(bell).toBeLessThan(repeat)
    expect(parts[repeat + 1].textContent).toMatch(/^\d{1,2}:\d{2}/)
    expect(
      row('Design review').querySelector('[aria-label="Reminder"]')
    ).toBeNull()
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
  it('says there are no events when a search matches none', () => {
    state.search = 'nothing like this'
    render(
      <I18nProvider i18n={i18n}>
        <Agenda onSelect={vi.fn()} />
      </I18nProvider>
    )
    expect(screen.getByText('No events')).toBeInTheDocument()
  })

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
