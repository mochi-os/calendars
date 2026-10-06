// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component, Event } from '@/api/types/events'
import { EventEditor } from './editor'

const START = Date.UTC(2026, 8, 16, 9) / 1000

function stored(
  title: string,
  rule = 'FREQ=WEEKLY;UNTIL=20261231T235959Z'
): Event {
  const components: Component[] = [
    {
      name: 'VEVENT',
      properties: [
        { name: 'UID', params: {}, value: 'u1' },
        { name: 'SUMMARY', params: {}, value: title },
        { name: 'DTSTART', params: {}, value: '20260916T090000Z' },
        { name: 'DTEND', params: {}, value: '20260916T100000Z' },
        { name: 'RRULE', params: {}, value: rule },
      ],
      components: [],
    },
  ]
  return {
    id: 'e1',
    calendar: 'c1',
    slug: 'e1',
    uid: 'u1',
    etag: 'x1',
    component: 'VEVENT',
    summary: title,
    start: START,
    finish: START + 3600,
    allday: false,
    recurring: true,
    created: 0,
    updated: 0,
    ics: '',
    components,
  }
}

// What the editor is given: the event being edited as the query answers it,
// and the mutation it saves through.
const state = vi.hoisted(() => ({
  editing: { mode: 'edit', event: 'e1', start: 0 } as unknown,
  setEditing: vi.fn(),
  query: {} as Record<string, unknown>,
  update: vi.fn(),
}))

beforeEach(() => {
  state.editing = { mode: 'edit', event: 'e1', start: START }
  state.setEditing = vi.fn()
  state.update = vi.fn().mockResolvedValue({})
  state.query = {
    data: { event: stored('Standup') },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
})

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    editing: state.editing,
    setEditing: state.setEditing,
    ordered: [{ id: 'c1', name: 'Home', colour: '#000', readonly: false }],
    remember: vi.fn(),
    reveal: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-events', () => ({
  useEventQuery: () => state.query,
  useCreateEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEventMutation: () => ({
    mutateAsync: state.update,
    isPending: false,
  }),
  useSplitEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-event-move', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/hooks/use-event-move')>()
  return { ...original, useOccurrenceMove: () => vi.fn() }
})
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return { ...original, useScreenSize: () => ({ isMobile: false }) }
})
// No router here: the leave guard's blocker is all the editor asks of one.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: () => ({ status: 'idle' }),
}))

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <EventEditor />
    </I18nProvider>
  )
}

function rule(components: Component[]) {
  const master = components.find((component) =>
    component.properties.every((property) => property.name !== 'RECURRENCE-ID')
  )
  return master?.properties.find((property) => property.name === 'RRULE')?.value
}

describe('EventEditor', () => {
  it('keeps the last day of a repeat when the field is cleared', async () => {
    show()
    const until = await screen.findByLabelText('Last day')
    fireEvent.change(until, { target: { value: '' } })
    fireEvent.blur(until)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'All events' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
    const saved = state.update.mock.calls[0][0] as { components: Component[] }
    expect(rule(saved.components)).toContain('UNTIL=')
  })

  it('lets the repeat interval be emptied to type a new number', async () => {
    show()
    const interval = await screen.findByLabelText('Every')
    fireEvent.change(interval, { target: { value: '' } })
    expect(interval).toHaveValue(null)
  })

  it('says a rule it cannot edit in words, never as its RRULE text', async () => {
    state.query = {
      ...state.query,
      data: { event: stored('Standup', 'FREQ=MONTHLY;BYDAY=2TU') },
    }
    show()
    expect(await screen.findByTestId('kept-rule')).toHaveTextContent(
      'Every month, on the second Tuesday'
    )
  })

  it('says nothing of a rule it cannot put into words', async () => {
    state.query = {
      ...state.query,
      data: {
        event: stored('Standup', 'FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE'),
      },
    }
    show()
    await screen.findByLabelText('Title')
    expect(screen.queryByTestId('kept-rule')).toBeNull()
    expect(screen.queryByText(/BYSETPOS/)).toBeNull()
  })

  it('puts the description straight below the title, two lines high', async () => {
    show()
    const title = await screen.findByLabelText('Title')
    const description = screen.getByLabelText('Description')
    const fields = [...document.querySelectorAll('input, textarea, button')]
    expect(fields.indexOf(description)).toBe(fields.indexOf(title) + 1)
    expect(description).toHaveAttribute('rows', '2')
    // The shared box's minimum height would hold it above two lines.
    expect(description.className).toContain('min-h-0')
  })

  it('orders the fields: calendar, title, description, location, URL, then the rest, colour last', async () => {
    show()
    await screen.findByLabelText('Title')
    const order = [
      'event-calendar',
      'event-title',
      'event-description',
      'event-location',
      'event-url',
      'event-allday',
      'event-repeat',
      'event-reminder',
    ].map((id) => document.getElementById(id)!)
    const fields = [...order, screen.getByText('Colour')]
    for (let index = 1; index < fields.length; index++) {
      expect(
        fields[index - 1].compareDocumentPosition(fields[index]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  })

  it('gives every field label an icon, and the full-width fields their label inside', async () => {
    show()
    await screen.findByLabelText('Title')
    for (const [id, name] of [
      ['event-title', 'Title'],
      ['event-description', 'Description'],
      ['event-location', 'Location'],
      ['event-url', 'URL'],
    ]) {
      const field = document.getElementById(id)!
      expect(field).toHaveAttribute('aria-label', name)
      expect(field).toHaveAttribute('placeholder', name)
      // Nothing beside it names it: it runs the full width.
      expect(document.querySelector(`label[for="${id}"]`)).toBeNull()
    }
    // The editor's own rows; a custom repeat's panel has sub-fields of its own.
    const labels = [
      'event-allday',
      'event-start',
      'event-finish',
      'event-repeat',
      'event-reminder',
    ].map((id) => document.querySelector(`label[for="${id}"]`))
    labels.push(screen.getByText('Colour').closest('label'))
    for (const label of labels) {
      expect(label?.querySelector('svg')).toBeTruthy()
    }
  })

  it('names the calendar inside its select, with the calendar icon beside the calendar', async () => {
    show()
    await screen.findByLabelText('Title')
    const calendar = document.getElementById('event-calendar')!
    expect(calendar).toHaveAttribute('aria-label', 'Calendar')
    expect(document.querySelector('label[for="event-calendar"]')).toBeNull()
    expect(screen.queryByText('Calendar')).toBeNull()
    // The trigger shows the chosen calendar as its entry in the list reads:
    // the calendar icon, then the name.
    expect(calendar).toHaveTextContent('Home')
    expect(calendar.querySelectorAll('svg').length).toBeGreaterThan(1)
  })

  it("shows each end's zone beside its time, with no time zone button", async () => {
    show()
    await screen.findByLabelText('Title')
    for (const end of ['Start', 'End']) {
      const time = document.querySelector(`[aria-label="${end} time"]`)!
      const zone = screen.getByRole('combobox', { name: `${end} time zone` })
      // The zone sits in the time's own row.
      expect(zone.parentElement!.contains(time)).toBe(true)
      expect(
        time.compareDocumentPosition(zone) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: 'Time zone' })).toBeNull()
  })

  it('shows no zones for an all-day event, which has no times', async () => {
    show()
    await screen.findByLabelText('Title')
    fireEvent.click(screen.getByLabelText('All day'))
    expect(screen.queryByRole('combobox', { name: /time zone/ })).toBeNull()
  })

  it('keeps the dates their width when all day is on, the time and zone leaving their room', async () => {
    show()
    await screen.findByLabelText('Title')
    const time = document.querySelector('[aria-label="Start time"]')!
    const timed = time.closest('.w-32')!.className
    const zoned = screen.getByRole('combobox', {
      name: 'Start time zone',
    }).className
    fireEvent.click(screen.getByLabelText('All day'))
    const times = screen.getAllByTestId('time-room')
    const zones = screen.getAllByTestId('zone-room')
    // One of each in the start row and the end row, beside the date.
    expect(times).toHaveLength(2)
    expect(zones).toHaveLength(2)
    for (const id of ['event-start', 'event-finish']) {
      const row = document.getElementById(id)!.closest('.flex-wrap')!
      expect(times.some((room) => row.contains(room))).toBe(true)
      expect(zones.some((room) => row.contains(room))).toBe(true)
    }
    // As wide as what they stand in for.
    for (const room of times) expect(timed).toContain(room.className)
    for (const room of zones) {
      expect(room.className).toContain('w-40')
      expect(zoned).toContain('w-40')
    }
  })

  it('gives both zones the room their longest city takes, and wraps the zone where date, time and zone no longer fit', async () => {
    show()
    await screen.findByLabelText('Title')
    // An element's Tailwind width in rem, from it or the nearest ancestor
    // carrying one: w-40 and min-w-36 are a quarter rem a step. A zero, such
    // as an input's own min-w-0, is no width.
    const rem = (element: Element, prefix: string) => {
      const pattern = new RegExp(`^${prefix}-(\\d+)$`)
      for (let at: Element | null = element; at; at = at.parentElement) {
        for (const name of at.classList) {
          const found = Number(pattern.exec(name)?.[1])
          if (found) return found / 4
        }
      }
      throw new Error(`no ${prefix}-* on or above ${element.outerHTML}`)
    }
    const zones = ['Start', 'End'].map((end) =>
      screen.getByRole('combobox', { name: `${end} time zone` })
    )
    // Ten rem: 160 pixels, leaving the city 110 beside the globe, where the
    // longest, Bahia Banderas, takes 100.
    for (const zone of zones) expect(rem(zone, 'w')).toBe(10)
    const date = rem(document.getElementById('event-start')!, 'min-w')
    const time = rem(document.querySelector('[aria-label="Start time"]')!, 'w')
    const zone = rem(zones[0], 'w')
    fireEvent.click(screen.getByLabelText('All day'))
    const room = screen.getAllByTestId('zone-room')[0].className
    const wrap = Number(/@max-\[(\d+(?:\.\d+)?)rem\]:hidden/.exec(room)?.[1])
    // The date's least width, the time and the zone, and the two gaps between.
    expect(wrap).toBe(date + time + zone + 1)
  })

  it('keeps what was typed when the event is read again in the background', async () => {
    const view = show()
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Typed' } })
    state.query = { ...state.query, data: { event: stored('Standup') } }
    view.rerender(
      <I18nProvider i18n={i18n}>
        <EventEditor />
      </I18nProvider>
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Typed')
  })

  it('stays open when the page outside it is clicked', async () => {
    show()
    await screen.findByLabelText('Title')
    // The dialog listens for a press outside only once it has opened.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    // A press outside dismisses on the click that ends it.
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.mouseUp(document.body)
    fireEvent.click(document.body)
    expect(state.setEditing).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says the event could not be read, with a way to try again', () => {
    state.query = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('offline'),
      refetch: vi.fn(),
    }
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.query.refetch).toHaveBeenCalledTimes(1)
  })
})
