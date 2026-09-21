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
import type { EventDraft } from '@/lib/ical'
import { useCalendarsQuery } from '@/hooks/use-calendars'
import { DEFAULTS, usePreferencesQuery } from '@/hooks/use-preferences'
import { useShownCalendars } from '@/hooks/use-shown'

const VIEWS: CalendarView[] = ['day', 'week', 'multiweek', 'month', 'list']

/** What the editor was opened on. */
export type Editing =
  | { mode: 'create'; draft: EventDraft }
  | { mode: 'edit'; event: string; start: number }

interface CalendarContextValue {
  calendars: Calendar[]
  /** Calendars sorted for display: the default one first, then by name. */
  ordered: Calendar[]
  visible: Calendar[]
  isLoading: boolean
  shown: (calendar: string) => boolean
  toggle: (calendar: string) => void
  only: (calendar: string) => void
  showAll: () => void
  hideAll: () => void
  preferences: Preferences
  view: CalendarView
  setView: (view: CalendarView) => void
  /** The anchored day, as YYYY-MM-DD in the user's own zone. */
  date: string
  setDate: (date: string) => void
  today: string
  range: CalendarRange
  /** List view: how many days the chosen span covers. */
  /** Week view: hide the days that are not work days. */
  workweek: boolean
  setWorkweek: (value: boolean) => void
  editing: Editing | null
  setEditing: (editing: Editing | null) => void
}

const CalendarContext = createContext<CalendarContextValue | null>(null)

export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const format = useFormat()
  const { isDesktop } = useScreenSize()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    view?: string
    date?: string
  }

  const { data, isLoading } = useCalendarsQuery()
  const calendars = useMemo(() => data?.calendars ?? [], [data?.calendars])
  const { shown, toggle, only, showAll, hideAll, visible } =
    useShownCalendars(calendars)

  const { data: preferenceData } = usePreferencesQuery()
  const preferences = preferenceData?.preferences ?? DEFAULTS

  const [lastView, setLastView] = useShellStorage<CalendarView>(
    'calendars:view',
    preferences.view
  )
  const [workweek, setWorkweek] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)

  const today = format.zonedDay(new Date())

  const urlView = VIEWS.includes(search.view as CalendarView)
    ? (search.view as CalendarView)
    : null
  // Below tablet width there is no room for a grid, so a grid view falls back
  // to the list. The URL keeps what the user asked for, so widening the window
  // puts it back.
  const requested = urlView ?? lastView
  const view =
    isDesktop || requested === 'day' || requested === 'list'
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
      void navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          view: next,
        }),
      })
    },
    [navigate, setLastView]
  )

  const setDate = useCallback(
    (next: string) => {
      void navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          date: next,
        }),
      })
    },
    [navigate]
  )

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
      shown,
      toggle,
      only,
      showAll,
      hideAll,
      preferences,
      view,
      setView,
      date,
      setDate,
      today,
      range,
      workweek,
      setWorkweek,
      editing,
      setEditing,
    }),
    [
      calendars,
      ordered,
      visible,
      isLoading,
      shown,
      toggle,
      only,
      showAll,
      hideAll,
      preferences,
      view,
      setView,
      date,
      setDate,
      today,
      range,
      workweek,
      editing,
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
