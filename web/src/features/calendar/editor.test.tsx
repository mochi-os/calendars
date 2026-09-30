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
