// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '@/hooks/use-preferences'
import { CalendarPage } from './index'

const calendar = { id: 'c1', name: 'Home', colour: '#000', readonly: false }

// What the page is given: the calendars and their state, and the range's
// occurrences as the query answers them.
const state = vi.hoisted(() => ({
  visible: [] as unknown[],
  failed: false,
  reload: vi.fn(),
  setEditing: vi.fn(),
  /** What the page last gave the month grid, the time grid and the toolbar. */
  month: {} as Record<string, unknown>,
  time: {} as Record<string, unknown>,
  toolbar: {} as Record<string, unknown>,
  view: 'month',
  date: '2026-09-15',
  query: {
    data: undefined as unknown,
    isSuccess: true,
    isPlaceholderData: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}))

beforeEach(() => {
  state.visible = [calendar]
  state.failed = false
  state.reload.mockReset()
  state.setEditing.mockReset()
  state.month = {}
  state.time = {}
  state.toolbar = {}
  state.view = 'month'
  state.date = '2026-09-15'
  state.query = {
    data: { instances: [] },
    isSuccess: true,
    isPlaceholderData: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
})

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    view: state.view,
    range:
      state.view === 'week'
        ? { from: '2026-09-14', days: 7, date: state.date }
        : { from: '2026-08-31', days: 42, date: state.date },
    date: state.date,
    setDate: vi.fn(),
    setView: vi.fn(),
    today: '2026-09-15',
    preferences: DEFAULTS,
    visible: state.visible,
    calendars: state.visible,
    workweek: false,
    editing: null,
    setEditing: state.setEditing,
    remembered: {},
    reveal: vi.fn(),
    failed: state.failed,
    reload: state.reload,
  }),
}))
vi.mock('@/hooks/use-events', () => ({
  useInstancesQuery: () => state.query,
  useCreateEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-event-move', () => ({ useEventMove: () => ({}) }))
vi.mock('@/hooks/use-reminder', () => ({ useReminder: () => undefined }))
vi.mock('@/features/calendar/components/toolbar', () => ({
  Toolbar: (props: Record<string, unknown>) => {
    state.toolbar = props
    return null
  },
}))
vi.mock('@/features/calendar/components/agenda', () => ({ Agenda: () => null }))
vi.mock('@/features/calendar/components/event-summary', () => ({
  EventSummaryPanel: () => null,
}))
vi.mock('@/features/calendar/components/scope-dialog', () => ({
  ScopeDialog: () => null,
}))
const router = vi.hoisted(() => ({ history: {} }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => router,
  useSearch: () => ({}),
}))
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    MonthGrid: (props: Record<string, unknown>) => {
      state.month = props
      return <div>month grid</div>
    },
    TimeGrid: (props: Record<string, unknown>) => {
      state.time = props
      return <div>time grid</div>
    },
    usePageTitle: () => undefined,
  }
})

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <CalendarPage />
    </I18nProvider>
  )
}

const TRUNCATED = 'Too many events to show them all. Choose a shorter range.'

describe('CalendarPage', () => {
  it('draws the grid when everything has loaded', () => {
    show()
    expect(screen.getByText('month grid')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('says the calendars could not be read, with a way to try again', () => {
    state.failed = true
    state.visible = []
    show()
    expect(screen.queryByText('month grid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.reload).toHaveBeenCalledTimes(1)
  })

  it("says the range's events could not be read rather than drawing an empty grid", () => {
    state.query = { ...state.query, data: undefined, isSuccess: false, isError: true }
    show()
    expect(screen.queryByText('month grid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.query.refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the too-many banner over the calendars it is about', () => {
    state.query = { ...state.query, data: { instances: [], truncated: true } }
    show()
    expect(screen.getByText(TRUNCATED)).toBeInTheDocument()
  })

  it('leaves the banner a previous range left behind out once every calendar is hidden', () => {
    state.visible = []
    state.query = {
      ...state.query,
      data: { instances: [], truncated: true },
      isPlaceholderData: true,
    }
    show()
    expect(screen.queryByText(TRUNCATED)).toBeNull()
  })

  it('opens a new all-day event over the days a drag across the month picked', () => {
    show()
    const pick = state.month.onCreateRange as (first: string, last: string) => void
    pick('2026-09-22', '2026-09-25')
    expect(state.setEditing).toHaveBeenCalledWith({
      mode: 'create',
      draft: expect.objectContaining({
        allday: true,
        calendar: 'c1',
        start: '2026-09-22',
        finish: '2026-09-25',
      }),
    })
  })

  it('puts a new event on today when today is in a wide month', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'))
    try {
      state.date = '2026-09-20'
      show()
      ;(state.toolbar.onCreate as () => void)()
      expect(state.setEditing).toHaveBeenCalledWith({
        mode: 'create',
        draft: expect.objectContaining({ start: '2026-09-15' }),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("opens a new all-day event over the days picked in the week's all-day band", () => {
    state.view = 'week'
    show()
    const pick = state.time.onCreateRange as (first: string, last: string) => void
    pick('2026-09-16', '2026-09-18')
    expect(state.setEditing).toHaveBeenCalledWith({
      mode: 'create',
      draft: expect.objectContaining({
        allday: true,
        start: '2026-09-16',
        finish: '2026-09-18',
      }),
    })
  })
})
