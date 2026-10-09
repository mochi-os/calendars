// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  naturalCompare,
  useFormat,
  useScreenSize,
  useShellStorage,
  viewRange,
  type CalendarRange,
  type CalendarView,
} from '@mochi/web'
import type { Calendar } from '@/api/types/calendars'
import type { Preferences } from '@/api/types/preferences'
import {
  REMEMBERED,
  remembered,
  type EventDraft,
  type Remembered,
} from '@/lib/ical'
import { useCalendarsQuery, useCalendarsRefresh } from '@/hooks/use-calendars'
import {
  DEFAULTS,
  usePreferencesQuery,
  useSetPreferencesMutation,
} from '@/hooks/use-preferences'
import { useShownCalendars } from '@/hooks/use-shown'

const VIEWS: CalendarView[] = ['day', 'week', 'multiweek', 'month', 'list']

/** What the editor was opened on. */
type Editing =
  | { mode: 'create'; draft: EventDraft }
  | { mode: 'edit'; event: string; start: number }

interface CalendarContextValue {
  calendars: Calendar[]
  /** Calendars sorted for display: the default one first, then by name. */
  ordered: Calendar[]
  visible: Calendar[]
  isLoading: boolean
  /** The calendar list could not be read. */
  failed: boolean
  /** Asks for the calendar list again. */
  reload: () => void
  shown: (calendar: string) => boolean
  toggle: (calendar: string) => void
  /** Shows a calendar an event was just saved into, if it was hidden. */
  reveal: (calendar: string) => void
  only: (calendar: string) => void
  preferences: Preferences
  view: CalendarView
  setView: (view: CalendarView) => void
  /** The anchored day, as YYYY-MM-DD in the user's own zone. */
  date: string
  setDate: (date: string) => void
  /**
   * The day atop the list view as it scrolls, which the toolbar's title,
   * the month pickers and paging follow; undefined outside the list, or
   * until the list says.
   */
  listed?: string
  /** Tells which day is atop the list view, under the current anchor. */
  setListed: (day: string) => void
  today: string
  range: CalendarRange
  /** Week view: hide the days that are not work days. */
  workweek: boolean
  setWorkweek: (value: boolean) => void
  /** The text the list view filters by, typed into the toolbar. */
  search: string
  setSearch: (value: string) => void
  editing: Editing | null
  setEditing: (editing: Editing | null) => void
  /** What the last new event saved on this device leaves for the next. */
  remembered: Remembered
  /** Keeps a just-saved new event's settings for the next one. */
  remember: (draft: EventDraft) => void
}

const CalendarContext = createContext<CalendarContextValue | null>(null)

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const format = useFormat()
  const { isMobile } = useScreenSize()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    view?: string
    date?: string
  }

  const { data, isLoading, isError, refetch } = useCalendarsQuery()
  useCalendarsRefresh()
  const calendars = useMemo(() => data?.calendars ?? [], [data?.calendars])
  const { shown, toggle, reveal, only, visible } =
    useShownCalendars(calendars)

  const { data: preferenceData } = usePreferencesQuery()
  const preferences = preferenceData?.preferences ?? DEFAULTS

  // The view this browser last showed; one that has shown none opens on the
  // view last chosen anywhere, which the preferences keep.
  const [lastView, setLastView] = useShellStorage<CalendarView | null>(
    'calendars:view',
    null
  )
  const { mutate: savePreferences } = useSetPreferencesMutation()
  // Kept per device like the last view, so a reload does not lose it.
  const [workweek, setWorkweek] = useShellStorage<boolean>(
    'calendars:workweek',
    false
  )
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [kept, setKept] = useShellStorage<Remembered>(
    'calendars:new',
    REMEMBERED
  )
  const remember = useCallback(
    (draft: EventDraft) => setKept(remembered(draft)),
    [setKept]
  )

  const today = format.zonedDay(new Date())

  const urlView = VIEWS.includes(search.view as CalendarView)
    ? (search.view as CalendarView)
    : null
  // Below tablet width (768px) there is no room for a grid, so a grid view
  // falls back to the list; a tablet has the grids. The URL keeps what the
  // user asked for, so widening the window puts it back.
  const requested = urlView ?? lastView ?? preferences.view
  const view =
    !isMobile || requested === 'day' || requested === 'list'
      ? requested
      : 'list'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(search.date ?? '')
    ? (search.date as string)
    : today

  // The URL is the state; the stored view only decides where the app reopens.
  useEffect(() => {
    if (urlView && urlView !== lastView) setLastView(urlView)
  }, [urlView, lastView, setLastView])

  const setView = useCallback(
    (next: CalendarView) => {
      setLastView(next)
      // Only the list filters by the search, so a grid would keep a box that
      // looks like a filter and filters nothing.
      if (next !== 'list') setQuery('')
      if (next !== preferences.view) savePreferences({ view: next })
      void navigate({
        to: '/',
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          view: next,
        }),
      })
    },
    [navigate, setLastView, preferences.view, savePreferences]
  )

  const setDate = useCallback(
    (next: string) => {
      // To the calendar, not '.': the sidebar's month picker is also on a
      // calendar's settings page, where a date on its own URL shows nothing.
      void navigate({
        to: '/',
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          date: next,
        }),
      })
    },
    [navigate]
  )

  // Measured under one anchor, the day atop the list lapses with it.
  const [top, setTop] = useState<{ date: string; day: string } | null>(null)
  const listed = view === 'list' && top?.date === date ? top.day : undefined
  const setListed = useCallback((day: string) => setTop({ date, day }), [date])

  const range = useMemo(
    () =>
      viewRange(view, date, {
        weekStartsOn: format.weekStartsOn,
        weeks: preferences.multiweek.weeks,
        previous: preferences.multiweek.previous,
      }),
    [
      view,
      date,
      format.weekStartsOn,
      preferences.multiweek.weeks,
      preferences.multiweek.previous,
    ]
  )

  const ordered = useMemo(
    () =>
      [...calendars].sort((a, b) => {
        if (a.default !== b.default) return a.default ? -1 : 1
        return naturalCompare(a.name, b.name)
      }),
    [calendars]
  )

  const value = useMemo(
    () => ({
      calendars,
      ordered,
      visible,
      isLoading,
      failed: isError,
      reload: () => void refetch(),
      shown,
      toggle,
      reveal,
      only,
      preferences,
      view,
      setView,
      date,
      setDate,
      listed,
      setListed,
      today,
      range,
      workweek,
      setWorkweek,
      search: query,
      setSearch: setQuery,
      editing,
      setEditing,
      remembered: kept,
      remember,
    }),
    [
      calendars,
      ordered,
      visible,
      isLoading,
      isError,
      refetch,
      shown,
      toggle,
      reveal,
      only,
      preferences,
      view,
      setView,
      date,
      setDate,
      listed,
      setListed,
      today,
      range,
      workweek,
      setWorkweek,
      query,
      editing,
      kept,
      remember,
    ]
  )

  return <CalendarContext value={value}>{children}</CalendarContext>
}

export function useCalendarContext(): CalendarContextValue {
  const value = useContext(CalendarContext)
  if (!value) {
    throw new Error('useCalendarContext must be used within CalendarProvider')
  }
  return value
}
