// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Instance } from '@/api/types/events'
import { EventPopover } from './event-popover'

// The map service the user chose, as useLinks() would read it from the
// preference the shell carries.
let service = 'openstreetmap'
let tracker = 'flightradar24'

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    useLinks: () => ({
      map: (location: string) => original.mapLink(location, service),
      flight: (flight: string) => original.flightLink(flight, tracker),
    }),
  }
})

const noon = Date.UTC(2026, 8, 25, 12) / 1000

function instance(location: string, description = ''): Instance {
  return {
    event: 'e1',
    calendar: 'c1',
    colour: '#60a5fa',
    readonly: true,
    uid: 'u1',
    component: 'VEVENT',
    summary: 'DUB:2-DEN 15:25-18:15',
    location,
    description,
    status: '',
    start: noon,
    finish: noon + 3600,
    allday: false,
    recurring: false,
  }
}

function show(location: string, description = '') {
  render(
    <I18nProvider i18n={i18n}>
      <EventPopover
        instance={instance(location, description)}
        anchor={{ left: 10, top: 10, width: 100, height: 20 } as DOMRect}
        onClose={vi.fn()}
      />
    </I18nProvider>
  )
}

describe('EventPopover copy', () => {
  it('offers Copy when the page can take one, handing the occurrence back', () => {
    const onCopy = vi.fn()
    render(
      <I18nProvider i18n={i18n}>
        <EventPopover
          instance={instance('Room 4')}
          anchor={{ left: 10, top: 10, width: 100, height: 20 } as DOMRect}
          onClose={vi.fn()}
          onCopy={onCopy}
        />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopy).toHaveBeenCalledWith(instance('Room 4'))
  })

  it('offers no Copy otherwise', () => {
    show('Room 4')
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })
})

describe('EventPopover location', () => {
  beforeEach(() => {
    service = 'openstreetmap'
    tracker = 'flightradar24'
  })

  it('links the location to a map search on the default service, in a new tab', () => {
    show('Meeting room')
    const link = screen.getByRole('link', { name: 'Meeting room' })
    expect(link.getAttribute('href')).toBe(
      'https://www.openstreetmap.org/search?query=Meeting%20room'
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('follows the chosen map service', () => {
    service = 'google'
    show('Studio')
    expect(
      screen.getByRole('link', { name: 'Studio' }).getAttribute('href')
    ).toBe('https://www.google.com/maps/search/?api=1&query=Studio')
  })

  it('sends a flight number to the flight tracker instead of a map', () => {
    show('EI59')
    expect(
      screen.getByRole('link', { name: 'EI59' }).getAttribute('href')
    ).toBe('https://www.flightradar24.com/data/flights/ei59')
  })

  it("recognises the airline's name before the number", () => {
    show('Aer Lingus EI59')
    expect(
      screen.getByRole('link', { name: 'Aer Lingus EI59' }).getAttribute('href')
    ).toBe('https://www.flightradar24.com/data/flights/ei59')
  })

  it('follows the chosen tracker', () => {
    tracker = 'flightaware'
    show('BA 123')
    expect(
      screen.getByRole('link', { name: 'BA 123' }).getAttribute('href')
    ).toBe('https://www.flightaware.com/live/flight/BA123')
  })

  it('shows no link when the event has no location', () => {
    show('')
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('EventPopover layout', () => {
  it('leads every row with a glyph of one size so the texts align', () => {
    show('Meeting room', 'Bring the slides.')
    const rows = [
      screen.getByRole('heading', { level: 2 }),
      screen.getByText(/to/, { selector: 'span' }),
      screen.getByRole('link', { name: 'Meeting room' }),
      screen.getByText('Bring the slides.'),
    ].map((text) => text.parentElement as HTMLElement)
    for (const row of rows) {
      const glyph = row.firstElementChild as HTMLElement
      expect(row.className).toContain('gap-1.5')
      expect(glyph.classList.contains('size-4')).toBe(true)
      expect(glyph.classList.contains('shrink-0')).toBe(true)
    }
    expect(rows[1].firstElementChild?.classList.contains('lucide-clock')).toBe(
      true
    )
    expect(
      rows[3].firstElementChild?.classList.contains('lucide-text-align-start')
    ).toBe(true)
  })
})

describe('EventPopover description', () => {
  it('shows an HTML description as text with its line breaks', () => {
    show('EI59', 'PNR: 2YHEIJ&nbsp;<br>Class: Business<br>Seats: 2K')
    const shown = screen.getByText(/PNR/)
    expect(shown.textContent).toBe('PNR: 2YHEIJ\nClass: Business\nSeats: 2K')
    expect(shown.textContent).not.toContain('<br>')
  })

  it('leaves a plain description untouched', () => {
    show('EI59', 'Bring the numbers\na < b')
    expect(screen.getByText(/Bring/).textContent).toBe(
      'Bring the numbers\na < b'
    )
  })
})

// The user's zone in these tests is the provider default, UTC.
describe('EventPopover zones', () => {
  // 10:00 London (BST) to 13:00 New York (EDT): 09:00Z to 17:00Z.
  const flight: Instance = {
    ...instance('EI59'),
    summary: 'Flight',
    start: Date.UTC(2026, 8, 25, 9) / 1000,
    finish: Date.UTC(2026, 8, 25, 17) / 1000,
    zone: { start: 'Europe/London', finish: 'America/New_York' },
  }
  function open(shown: Instance, zones: boolean) {
    // One dialog at a time: a test may open two.
    cleanup()
    render(
      <I18nProvider i18n={i18n}>
        <EventPopover
          instance={shown}
          anchor={{ left: 10, top: 10, width: 100, height: 20 } as DOMRect}
          zones={zones}
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    return screen.getByRole('dialog').textContent ?? ''
  }

  it('names each end with its city when events are shown in their own zones', () => {
    const text = open(flight, true)
    expect(text).toContain('10:00 London to 13:00 New York')
    expect(text).not.toContain('09:00 to 17:00')
  })

  it('keeps the user zone and adds the ends in their own zones beneath otherwise', () => {
    const text = open(flight, false)
    expect(text).toContain('09:00 to 17:00')
    expect(text).toContain('10:00 London to 13:00 New York')
  })

  it('says nothing about zones for an event written in the user zone', () => {
    const text = open(
      { ...flight, zone: { start: 'UTC', finish: 'UTC' } },
      false
    )
    expect(text).toContain('09:00 to 17:00')
    expect(text).not.toContain('London')
    expect(
      open({ ...flight, zone: { start: '', finish: '' } }, true)
    ).not.toContain('UTC')
  })
})
