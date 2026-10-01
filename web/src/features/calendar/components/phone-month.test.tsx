// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { dayList, type CalendarEvent } from '@mochi/web'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhoneMonth } from './phone-month'

const DAYS = dayList('2026-09-28', 42)

// Noon UTC keeps a timed occurrence on its date in any zone the test runs in.
const noon = (day: number, month = 10) =>
  Date.UTC(2026, month - 1, day, 12) / 1000

const event = (
  key: string,
  title: string,
  day: number,
  rest: Partial<CalendarEvent> = {}
): CalendarEvent => ({
  key,
  title,
  colour: '#2563eb',
  start: noon(day),
  finish: noon(day) + 3600,
  allday: false,
  ...rest,
})

function show(events: CalendarEvent[], date = '2026-10-08', selected?: string) {
  const onDate = vi.fn()
  const onSelect = vi.fn()
  const { container } = render(
    <I18nProvider i18n={i18n}>
      <PhoneMonth
        days={DAYS}
        month={10}
        events={events}
        today='2026-10-01'
        date={date}
        onDate={onDate}
        selected={selected}
        onSelect={onSelect}
      />
    </I18nProvider>
  )
  const cell = (day: string) =>
    container.querySelector(`[data-day="${day}"]`) as HTMLElement
  return { onDate, onSelect, cell }
}

describe('PhoneMonth', () => {
  it('lists the chosen day under the month, all-day first', () => {
    show([
      event('a', 'Standup', 8),
      event('b', 'Holiday', 8, {
        allday: true,
        date: '2026-10-08',
        start: Date.UTC(2026, 9, 8) / 1000,
        finish: Date.UTC(2026, 9, 9) / 1000,
      }),
      event('c', 'Other day', 9),
    ])
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/Holiday/)
    expect(rows[1]).toMatch(/Standup/)
    expect(screen.queryByText('Other day')).toBeNull()
  })

  it('marks each day with a dot per event, three at most', () => {
    const { cell } = show([
      event('a', 'One', 8),
      event('b', 'Two', 8),
      event('c', 'Three', 8),
      event('d', 'Four', 8),
      event('e', 'Alone', 9),
    ])
    const dots = (day: string) =>
      cell(day).querySelectorAll('span[aria-hidden]').length
    expect(dots('2026-10-08')).toBe(3)
    expect(dots('2026-10-09')).toBe(1)
    expect(dots('2026-10-10')).toBe(0)
  })

  it('puts a multi-day event on every day it covers', () => {
    const { cell } = show([
      event('a', 'Trip', 8, {
        allday: true,
        date: '2026-10-08',
        start: Date.UTC(2026, 9, 8) / 1000,
        finish: Date.UTC(2026, 9, 11) / 1000,
      }),
    ])
    for (const day of ['2026-10-08', '2026-10-09', '2026-10-10']) {
      expect(cell(day).querySelectorAll('span[aria-hidden]')).toHaveLength(1)
    }
    expect(
      cell('2026-10-11').querySelectorAll('span[aria-hidden]')
    ).toHaveLength(0)
  })

  it('chooses a tapped day, and marks the chosen one', () => {
    const { onDate, cell } = show([])
    expect(cell('2026-10-08').getAttribute('aria-pressed')).toBe('true')
    expect(cell('2026-10-09').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(cell('2026-10-15'))
    expect(onDate).toHaveBeenCalledWith('2026-10-15')
  })

  it('opens an event from the list, and tints the open one', () => {
    const { onSelect } = show([event('a', 'Standup', 8)], '2026-10-08', 'a')
    const row = screen.getByText('Standup').closest('button') as HTMLElement
    expect(row.classList.contains('bg-primary/10')).toBe(true)
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('a', row)
  })

  it('says a day with nothing on it has no events', () => {
    show([event('a', 'Standup', 9)])
    expect(screen.getByText('No events')).toBeInTheDocument()
  })
})
