// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instance } from '@/api/types/events'
import { CalendarPage } from './index'

const { setEditing, get, listed, context } = vi.hoisted(() => {
  const setEditing = vi.fn()
  return {
    setEditing,
    get: vi.fn(),
    // What the list offers to click, set by each test.
    listed: { instance: null as unknown },
    context: {
      view: 'list',
      range: { from: '2026-09-28', days: 7 },
      date: '2026-09-30',
      setDate: vi.fn(),
      setView: vi.fn(),
      today: '2026-09-30',
      preferences: {
        zones: false,
        days: [1, 2, 3, 4, 5],
        calendar: '',
        reminder: -1,
        hours: { start: 9, finish: 17 },
        duration: 60,
      },
      visible: [],
      calendars: [{ id: 'c1', name: 'Personal', readonly: false }],
      workweek: false,
      editing: null,
      setEditing,
      remembered: { allday: false },
      reveal: vi.fn(),
    },
  }
})

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => context,
}))
vi.mock('@/hooks/use-events', () => ({
  useInstancesQuery: () => ({ data: undefined }),
}))
vi.mock('@/hooks/use-event-move', () => ({
  useEventMove: () => ({}),
}))
vi.mock('@/api/events', () => ({ eventsApi: { get } }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}))
vi.mock('@/features/calendar/components/toolbar', () => ({
  Toolbar: () => null,
}))
// The list is only a way to click an occurrence here.
vi.mock('@/features/calendar/components/agenda', () => ({
  Agenda: ({
    onSelect,
  }: {
    onSelect: (instance: Instance, anchor: HTMLElement) => void
  }) => (
    <button
      type='button'
      onClick={(click) =>
        onSelect(listed.instance as Instance, click.currentTarget)
      }
    >
      occurrence
    </button>
  ),
}))
// The quick view as the actions it was handed.
vi.mock('@/features/calendar/components/event-popover', () => ({
  EventPopover: (props: {
    instance: Instance | null
    onEdit?: (instance: Instance) => void
    onDelete?: (instance: Instance) => void
    onCopyOwn?: (instance: Instance) => void
    onCopy?: (instance: Instance) => void
  }) =>
    props.instance ? (
      <div data-testid='quick-view'>
        {(['onEdit', 'onDelete', 'onCopyOwn', 'onCopy'] as const).map(
          (name) =>
            props[name] && (
              <button
                key={name}
                type='button'
                onClick={() => props[name]!(props.instance!)}
              >
                {name}
              </button>
            )
        )}
      </div>
    ) : null,
}))
vi.mock('@/features/calendar/components/delete-event-dialog', () => ({
  DeleteEventDialog: (props: { event: string | null; recurring?: boolean }) =>
    props.event ? (
      <div data-testid='deleting'>
        {props.event}:{String(props.recurring)}
      </div>
    ) : null,
}))

const ZONE = 'UTC'
const start = Date.UTC(2026, 8, 30, 9) / 1000

function occurrence(overrides: Partial<Instance> = {}): Instance {
  return {
    event: 'e1',
    calendar: 'c1',
    summary: 'Standup',
    location: '',
    description: '',
    colour: '',
    start,
    finish: start + 3600,
    allday: false,
    readonly: false,
    recurring: false,
    exception: false,
    ...overrides,
  } as Instance
}

// A daily series starting on the 28th, as the stored event reads.
const series = [
  {
    name: 'VEVENT',
    properties: [
      { name: 'SUMMARY', params: {}, value: 'Standup' },
      {
        name: 'DTSTART',
        params: { TZID: [ZONE] },
        value: '20260928T090000',
      },
      { name: 'DTEND', params: { TZID: [ZONE] }, value: '20260928T100000' },
      { name: 'RRULE', params: {}, value: 'FREQ=DAILY' },
    ],
    components: [],
  },
]

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <CalendarPage />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'occurrence' }))
}

describe('the quick view', () => {
  beforeEach(() => {
    setEditing.mockClear()
    get.mockReset()
  })

  it('offers an own event Edit, Delete and Copy, and opens the editor on Edit', () => {
    listed.instance = occurrence()
    show()
    expect(screen.getByTestId('quick-view')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'onCopy' })).toBeNull()
    expect(setEditing).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'onEdit' }))
    expect(setEditing).toHaveBeenCalledWith({
      mode: 'edit',
      event: 'e1',
      start,
    })
  })

  it('offers a read-only occurrence only its Copy', () => {
    listed.instance = occurrence({ readonly: true })
    show()
    for (const name of ['onEdit', 'onDelete', 'onCopyOwn'])
      expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('button', { name: 'onCopy' })).toBeInTheDocument()
  })

  it('hands Delete the occurrence and whether it repeats', () => {
    listed.instance = occurrence({ recurring: true })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'onDelete' }))
    expect(screen.getByTestId('deleting')).toHaveTextContent('e1:true')
    expect(screen.queryByTestId('quick-view')).toBeNull()
  })

  it('asks which of a series to copy, then opens the copy', async () => {
    listed.instance = occurrence({ recurring: true })
    get.mockResolvedValue({ event: { components: series } })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'onCopyOwn' }))
    fireEvent.click(await screen.findByRole('button', { name: 'All events' }))
    const next = setEditing.mock.lastCall?.[0] as {
      mode: string
      copy: boolean
      draft: { start: string; repeat: { frequency: string } }
    }
    expect(next.mode).toBe('create')
    expect(next.copy).toBe(true)
    expect(next.draft.start).toBe('2026-09-28')
    expect(next.draft.repeat.frequency).toBe('daily')
  })

  it('drops a late Copy once another event was opened', async () => {
    let answer: (value: unknown) => void = () => {}
    get.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    listed.instance = occurrence()
    show()
    fireEvent.click(screen.getByRole('button', { name: 'onCopyOwn' }))

    // Event B, opened and edited while A's copy is still loading.
    listed.instance = occurrence({ event: 'e2' })
    fireEvent.click(screen.getByRole('button', { name: 'occurrence' }))
    fireEvent.click(screen.getByRole('button', { name: 'onEdit' }))
    answer({ event: { components: series } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setEditing).toHaveBeenCalledTimes(1)
    expect(setEditing).toHaveBeenLastCalledWith({
      mode: 'edit',
      event: 'e2',
      start,
    })
  })

  it('drops a late Copy once an editor opened some other way', async () => {
    let answer: (value: unknown) => void = () => {}
    get.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    listed.instance = occurrence()
    const { rerender } = render(
      <I18nProvider i18n={i18n}>
        <CalendarPage />
      </I18nProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'occurrence' }))
    fireEvent.click(screen.getByRole('button', { name: 'onCopyOwn' }))

    // N, or the New button, opens an editor while the copy loads.
    context.editing = { mode: 'create' } as never
    rerender(
      <I18nProvider i18n={i18n}>
        <CalendarPage />
      </I18nProvider>
    )
    answer({ event: { components: series } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    context.editing = null
    expect(setEditing).not.toHaveBeenCalled()
  })

  it('copies a one-off event straight into the editor', async () => {
    listed.instance = occurrence()
    get.mockResolvedValue({
      event: {
        components: [
          { ...series[0], properties: series[0].properties.slice(0, 3) },
        ],
      },
    })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'onCopyOwn' }))
    await waitFor(() => expect(setEditing).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
    const next = setEditing.mock.lastCall?.[0] as {
      draft: { title: string; repeat: { frequency: string } }
    }
    expect(next.draft.title).toBe('Standup')
    expect(next.draft.repeat.frequency).toBe('never')
  })
})
