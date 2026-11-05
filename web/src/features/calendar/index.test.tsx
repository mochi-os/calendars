// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  setDate: vi.fn(),
  setListed: vi.fn(),
  listed: undefined as string | undefined,
  /** What the page last gave the month grid, the time grid and the toolbar. */
  month: {} as Record<string, unknown>,
  time: {} as Record<string, unknown>,
  toolbar: {} as Record<string, unknown>,
  agenda: {} as Record<string, unknown>,
  view: 'month',
  date: '2026-09-15',
  hidden: [] as string[],
  none: false,
  settled: true,
  /** Whether the preferences ask for week numbers. */
  numbers: false,
  /** What the page last asked the range query for. */
  asked: [] as unknown[],
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
  state.setDate.mockReset()
  state.setListed.mockReset()
  state.listed = undefined
  state.month = {}
  state.time = {}
  state.toolbar = {}
  state.agenda = {}
  state.view = 'month'
  state.date = '2026-09-15'
  state.hidden = []
  state.none = false
  state.settled = true
  state.numbers = false
  state.asked = []
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
    setDate: state.setDate,
    listed: state.listed,
    setListed: state.setListed,
    setView: vi.fn(),
    today: '2026-09-15',
    preferences: { ...DEFAULTS, week: { numbers: state.numbers } },
    visible: state.visible,
    hidden: state.hidden,
    none: state.none,
    settled: state.settled,
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
  useInstancesQuery: (...args: unknown[]) => {
    state.asked = args
    return state.query
  },
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
vi.mock('@/features/calendar/components/agenda', () => ({
  Agenda: (props: Record<string, unknown>) => {
    state.agenda = props
    return null
  },
}))
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

describe('CalendarPage list', () => {
  it('tells the context the day atop the list, and pages on from it with the arrow keys', () => {
    state.view = 'list'
    show()
    expect(state.agenda.onTop).toBe(state.setListed)
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(state.setDate).toHaveBeenLastCalledWith('2026-10-01')
    cleanup()
    state.listed = '2026-10-03'
    show()
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(state.setDate).toHaveBeenLastCalledWith('2026-11-01')
  })

  it('puts a new event on the day the list has scrolled to, not today', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'))
    try {
      state.view = 'list'
      state.listed = '2026-10-03'
      show()
      ;(state.toolbar.onCreate as () => void)()
      expect(state.setEditing).toHaveBeenCalledWith({
        mode: 'create',
        draft: expect.objectContaining({ start: '2026-10-03' }),
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CalendarPage', () => {
  it('draws the grid when everything has loaded', () => {
    show()
    expect(screen.getByText('month grid')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('numbers the weeks of the grid only when the preference says so', () => {
    show()
    expect(state.month.weekNumbers).toBe(false)
    cleanup()
    state.numbers = true
    show()
    expect(state.month.weekNumbers).toBe(true)
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

  // The range is asked for by the calendars hidden in this browser, so it
  // need not wait for the calendar list.
  it('asks for the range by the hidden calendars once the browser has said which', () => {
    state.hidden = ['c2']
    show()
    expect(state.asked[2]).toEqual(['c2'])
    expect(state.asked[4]).toBe(true)
  })

  it('does not ask before the browser has said which calendars are hidden', () => {
    state.settled = false
    show()
    expect(state.asked[4]).toBe(false)
  })

  it('asks nothing once every calendar is hidden', () => {
    state.none = true
    show()
    expect(state.asked[4]).toBe(false)
  })

  it('leaves the banner a previous range left behind out once every calendar is hidden', () => {
    state.visible = []
    state.none = true
    state.query = {
      ...state.query,
      data: { instances: [], truncated: true },
      isPlaceholderData: true,
    }
    show()
    expect(screen.queryByText(TRUNCATED)).toBeNull()
  })

  it('opens a new all-day event over the days a drag across the month picked', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T10:20:00Z'))
    try {
      show()
      const pick = state.month.onCreateRange as (
        first: string,
        last: string
      ) => void
      pick('2026-09-22', '2026-09-25')
      // Beneath, the times turning all day off gives: the working hours on
      // a day that is not today, for the default length, on the last day.
      expect(state.setEditing).toHaveBeenCalledWith({
        mode: 'create',
        draft: expect.objectContaining({
          allday: true,
          calendar: 'c1',
          start: '2026-09-22',
          startTime: 8 * 60,
          finish: '2026-09-25',
          finishTime: 9 * 60,
        }),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds beneath a drag from today the next whole hour, as a new event starts', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T10:20:00Z'))
    try {
      show()
      const pick = state.month.onCreateRange as (
        first: string,
        last: string
      ) => void
      pick('2026-09-15', '2026-09-17')
      expect(state.setEditing).toHaveBeenCalledWith({
        mode: 'create',
        draft: expect.objectContaining({
          start: '2026-09-15',
          startTime: 11 * 60,
          finish: '2026-09-17',
          finishTime: 12 * 60,
        }),
      })
    } finally {
      vi.useRealTimers()
    }
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
