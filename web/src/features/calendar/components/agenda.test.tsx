// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { Instance } from '@/api/types/events'
import { Agenda } from './agenda'

const calendar = { id: 'c1', name: 'Test calendar', colour: '#60a5fa' }

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    preferences: { zones: false },
    date: '2026-09-22',
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
  useBoundsQuery: () => ({ data: { first: 0, last: 0, endless: false } }),
  useInstancePages: () => ({
    instances: [
      instance(22, 'Design review'),
      instance(23, 'Wax boots'),
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
  }),
}))

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <Agenda onSelect={vi.fn()} />
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
