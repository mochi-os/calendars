// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instance } from '@/api/types/events'
import { CalendarPage } from './index'

const { setEditing, listed, context } = vi.hoisted(() => {
  const setEditing = vi.fn()
  return {
    setEditing,
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
// The summary popover as the actions it was handed.
vi.mock('@/features/calendar/components/event-popover', () => ({
  EventPopover: (props: {
    instance: Instance | null
    onCopy?: (instance: Instance) => void
  }) =>
    props.instance ? (
      <div data-testid='summary'>
        {props.onCopy && (
          <button type='button' onClick={() => props.onCopy!(props.instance!)}>
            onCopy
          </button>
        )}
      </div>
    ) : null,
}))

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

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <CalendarPage />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'occurrence' }))
}

describe('a click on an occurrence', () => {
  beforeEach(() => {
    setEditing.mockClear()
  })

  it('opens an own event straight in the editor', () => {
    listed.instance = occurrence()
    show()
    expect(setEditing).toHaveBeenCalledWith({
      mode: 'edit',
      event: 'e1',
      start,
    })
    expect(screen.queryByTestId('summary')).toBeNull()
  })

  it('opens a read-only occurrence in the summary, offering only a copy', () => {
    listed.instance = occurrence({ readonly: true })
    show()
    expect(screen.getByTestId('summary')).toBeInTheDocument()
    expect(setEditing).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'onCopy' }))
    expect(setEditing).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'create', copy: true })
    )
  })

  it('opens a birthday in the summary', () => {
    listed.instance = occurrence({ event: 'birthday-c1-2026' })
    show()
    expect(screen.getByTestId('summary')).toBeInTheDocument()
    expect(setEditing).not.toHaveBeenCalled()
  })
})
