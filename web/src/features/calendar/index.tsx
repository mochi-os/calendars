// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import {
  addDays,
  dayList,
  dayOfWeek,
  eventStatus,
  GeneralError,
  getErrorMessage,
  MonthGrid,
  monthOf,
  stepDate,
  TimeGrid,
  toast,
  useFormat,
  usePageTitle,
  offsetLabel,
  type CalendarEvent,
} from '@mochi/web'
import { Check } from 'lucide-react'
import type { Instance } from '@/api/types/events'
import {
  creationDay,
  defaultCalendar,
  defaultStart,
  draftComponent,
  draftInstants,
  instanceDraft,
  newDraft,
  type EventDraft,
  type Scope,
} from '@/lib/ical'
import { useCalendarContext } from '@/context/calendar-context'
import { useCalendarShortcuts } from '@/hooks/use-calendar-shortcuts'
import { useEventMove } from '@/hooks/use-event-move'
import {
  useCreateEventMutation,
  useInstancesQuery,
} from '@/hooks/use-events'
import { useReminder } from '@/hooks/use-reminder'
import { Agenda } from '@/features/calendar/components/agenda'
import { EventSummaryPanel } from '@/features/calendar/components/event-summary'
import { ScopeDialog } from '@/features/calendar/components/scope-dialog'
import { Toolbar } from '@/features/calendar/components/toolbar'

export function CalendarPage() {
  const { t } = useLingui()
  const format = useFormat()
  usePageTitle(t`Calendars`)
  const {
    view,
    range,
    date,
    setDate,
    setView,
    today,
    preferences,
    visible,
    calendars,
    workweek,
    editing,
    setEditing,
    remembered,
    reveal,
    failed,
    reload,
  } = useCalendarContext()

  // A read-only occurrence, open in its read-only panel.
  const [selected, setSelected] = useState<Instance | null>(null)
  const [moving, setMoving] = useState<{
    run: (scope: Scope) => void
    copy: boolean
  } | null>(null)

  const mover = useEventMove({ reveal, zones: preferences.zones })

  // With events shown in their own zones, a day's occurrences can begin or
  // end up to a day away by the user's clock, so the window grows a day each
  // side and the views place what falls on their days.
  const margin = preferences.zones ? 86400 : 0
  const start = format.timestampAt(range.from, 0) - margin
  const finish = format.timestampAt(addDays(range.from, range.days), 0) + margin
  // The list fetches its own pages, so the range query is idle there.
  const shown = useMemo(
    () => (view === 'list' ? [] : visible.map((c) => c.id)),
    [view, visible]
  )
  const { data, isSuccess, isPlaceholderData, isError, error, refetch } =
    useInstancesQuery(
    start,
    finish,
    shown,
    format.timezone
  )
  // Each occurrence arrives in its event's own colour, else its calendar's;
  // recolouring a calendar fetches the range again.
  const instances = useMemo(
    () => (shown.length === 0 ? [] : (data?.instances ?? [])),
    [shown.length, data?.instances]
  )

  // Every occurrence seen, by key: a drag that turns the page carries its
  // block into a range the occurrence is no longer part of, and the drop
  // still has to find it.
  const seen = useRef(new Map<string, Instance>())
  const byKey = useMemo(() => {
    const out = seen.current
    for (const instance of instances) {
      out.set(`${instance.event}:${instance.start}`, instance)
    }
    return out
  }, [instances])

  const events: CalendarEvent[] = useMemo(
    () =>
      instances.map((instance) => ({
        key: `${instance.event}:${instance.start}`,
        title: instance.summary,
        location: instance.location,
        description: instance.description,
        colour: instance.colour,
        start: instance.start,
        finish: instance.finish,
        allday: instance.allday,
        date: instance.date,
        readonly: instance.readonly || instance.event.startsWith('birthday-'),
        recurring: instance.recurring,
        exception: instance.exception,
        alarm: instance.alarm,
        status: eventStatus(instance.status),
        // Each end's own zone, only when the user shows events in their
        // zones; an end without one is placed in the user's zone.
        zone:
          preferences.zones && instance.zone
            ? {
                start: instance.zone.start || undefined,
                finish: instance.zone.finish || undefined,
              }
            : undefined,
      })),
    [instances, preferences.zones]
  )

  const days = useMemo(() => {
    const list = dayList(range.from, range.days)
    if (view === 'week' && workweek) {
      return list.filter((day) => preferences.days.includes(dayOfWeek(day)))
    }
    return list
  }, [range.from, range.days, view, workweek, preferences.days])

  // A new event goes in the calendar the preferences name, the same on every
  // device, and reads in the zones the last one used on this device.
  const calendarFor = useCallback(
    () => defaultCalendar(calendars, preferences.calendar),
    [calendars, preferences.calendar]
  )

  const compose = useCallback(
    (from: number, to: number, allday = false): EventDraft => {
      const calendar = calendarFor()
      return newDraft(from, to, {
        allday,
        calendar,
        reminder: preferences.reminder,
        user: format.timezone,
        zone: remembered.zone ?? {
          start: format.timezone,
          finish: format.timezone,
        },
      })
    },
    [calendarFor, format.timezone, preferences.reminder, remembered.zone]
  )

  // A new event with no time of its own: the next whole hour today, the
  // start of the working hours on another day, the length the user set, and
  // all-day when the last new event was. A click on the hour grid says
  // timed, but the button and a day cell have nothing else to go on.
  const createAt = (day: string) => {
    const now = new Date()
    const start = defaultStart(
      day,
      format.zonedDay(now),
      format.zonedMinutes(now),
      preferences.hours
    )
    const from = format.timestampAt(start.day, start.minutes)
    setEditing({
      mode: 'create',
      draft: compose(from, from + preferences.duration * 60, remembered.allday),
    })
  }

  // "New event" lands on today when today is on screen, and otherwise on
  // the day the view is on.
  const createNow = () =>
    createAt(
      creationDay(format.zonedDay(new Date()), date, range.from, range.days)
    )

  // A day cell in the month views says which day, not which kind, so it
  // takes the remembered all-day switch like the button does.
  const createOnDay = (day: string) => createAt(day)

  // A drag across day cells or the all-day band says which days, and a run
  // of days is an all-day event. The times underneath start at the working
  // hours, for a user who turns all-day off.
  const createOnDays = (first: string, last: string) => {
    const minutes = preferences.hours.start * 60
    const from = format.timestampAt(first, minutes)
    const to = format.timestampAt(
      last,
      Math.min(minutes + preferences.duration, 24 * 60 - 1)
    )
    setEditing({ mode: 'create', draft: compose(from, to, true) })
  }

  // A click opens the event in its side panel; a read-only occurrence (a
  // subscription's or a birthday) has nothing to edit, so its panel only
  // reads.
  const open = (instance: Instance) => {
    if (instance.readonly || instance.event.startsWith('birthday-')) {
      setSelected(instance)
    } else {
      setEditing({ mode: 'edit', event: instance.event, start: instance.start })
    }
  }

  // The occurrence whose summary or editor is open, which the views tint.
  const current = selected
    ? `${selected.event}:${selected.start}`
    : editing?.mode === 'edit'
      ? `${editing.event}:${editing.start}`
      : undefined

  // A reminder's link opens the calendar at the event it is for.
  const search = useSearch({ strict: false }) as {
    event?: string
    occurrence?: number
  }
  const navigate = useNavigate()
  useReminder({
    event: search.event,
    occurrence: search.occurrence,
    instances,
    // Until the shown calendars' own occurrences arrive, one missing from
    // them proves nothing: the previous range's stand in while they load.
    loading: shown.length > 0 && (!isSuccess || isPlaceholderData),
    visible,
    reveal,
    open: (instance) => open(instance),
    clear: () =>
      navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          event: undefined,
          occurrence: undefined,
        }),
        replace: true,
      }),
  })

  // The address names the event in the panel, as a project's does its
  // object, so the link reopens it. It is written in place with the router's
  // subscribers held off: the router never holds it, so closing the panel
  // cannot be undone by the reminder above reading it again. The page's own
  // first address, a reminder's link, is left for the reminder.
  const router = useRouter()
  const named = useRef<string | null | undefined>(undefined)
  const naming =
    editing?.mode === 'edit'
      ? { event: editing.event, occurrence: editing.start }
      : selected
        ? { event: selected.event, occurrence: selected.start }
        : null
  const nameKey = naming ? `${naming.event}:${naming.occurrence}` : null
  useEffect(() => {
    if (named.current === undefined && nameKey === null) {
      named.current = null
      return
    }
    if (named.current === nameKey) return
    named.current = nameKey
    const url = new URL(window.location.href)
    if (naming) {
      url.searchParams.set('event', naming.event)
      url.searchParams.set('occurrence', String(naming.occurrence))
    } else {
      url.searchParams.delete('event')
      url.searchParams.delete('occurrence')
    }
    const history = router.history as unknown as {
      _ignoreSubscribers?: boolean
    }
    history._ignoreSubscribers = true
    try {
      window.history.replaceState(
        window.history.state,
        '',
        url.pathname + url.search + url.hash
      )
    } finally {
      history._ignoreSubscribers = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- naming is nameKey's
  }, [nameKey, router])

  // A read-only occurrence's copy is the user's own event, made at once from
  // what the listing says of it, in the user's calendar, and opened there.
  const createMutation = useCreateEventMutation()
  const copyOccurrence = async (instance: Instance) => {
    const draft = instanceDraft(
      instance,
      calendarFor(),
      preferences.reminder,
      format.timezone
    )
    try {
      const result = await createMutation.mutateAsync({
        calendar: draft.calendar,
        components: [draftComponent(draft)],
      })
      reveal(draft.calendar)
      toast.success(t`Event copied`)
      setSelected(null)
      setEditing({
        mode: 'edit',
        event: result.event.id,
        start: draftInstants(draft).start,
      })
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to save the event`))
    }
  }

  const select = (key: string) => {
    const instance = byKey.get(key)
    if (instance) open(instance)
  }

  // A drag on a repeating occurrence has to say which occurrences it moved.
  const requestMove = (
    instance: Instance,
    run: (scope: Scope) => void,
    copy = false
  ) => {
    if (instance.recurring) setMoving({ run, copy })
    else run('all')
  }

  const page = (direction: number) => setDate(stepDate(view, date, direction))

  useCalendarShortcuts({
    blocked: Boolean(editing || selected || moving),
    today: () => setDate(today),
    page,
    create: createNow,
    view: setView,
    search: () => document.getElementById('calendar-search')?.focus(),
  })

  const grid = failed ? (
    <GeneralError mode='inline' className='my-6' reset={reload} />
  ) : view !== 'list' && isError ? (
    <GeneralError
      mode='inline'
      className='my-6'
      error={error}
      reset={() => void refetch()}
    />
  ) : view === 'list' ? (
      <Agenda selected={current} onSelect={open} />
    ) : view === 'day' || view === 'week' ? (
      <TimeGrid
        days={days}
        events={events}
        duration={preferences.duration}
        hours={preferences.hours}
        workdays={preferences.days}
        today={today}
        // With events at their own wall-clock times, the gutter says whose
        // clock its hours are.
        zone={preferences.zones ? offsetLabel(format.timezone) : undefined}
        selected={current}
        onSelect={select}
        onCreate={(from, to) =>
          setEditing({ mode: 'create', draft: compose(from, to) })
        }
        onCreateRange={createOnDays}
        onMove={({ key, start: from, finish: to, allday, copy, calendar }) => {
          const instance = byKey.get(key)
          if (!instance || instance.readonly) return
          const options = { copy }
          const run = calendar
            ? mover.toCalendar(instance, calendar, options)
            : allday
              ? mover.toAllday(
                  instance,
                  format.zonedDay(new Date(from * 1000)),
                  options
                )
              : mover.toTime(instance, from, to, options)
          requestMove(instance, run, copy)
        }}
        onDay={(day) => {
          setDate(day)
          setView('day')
        }}
        onStep={page}
      />
    ) : (
      <MonthGrid
        days={days}
        month={view === 'month' ? monthOf(range.date) : undefined}
        events={events}
        today={today}
        weekNumbers
        allday={preferences.allday}
        selected={current}
        onSelect={select}
        onCreate={createOnDay}
        onCreateRange={createOnDays}
        onMove={({ key, day, copy, calendar }) => {
          const instance = byKey.get(key)
          if (!instance || instance.readonly) return
          const run = calendar
            ? mover.toCalendar(instance, calendar, { copy })
            : mover.toDay(instance, day, { copy })
          requestMove(instance, run, copy)
        }}
        onDay={(day) => {
          setDate(day)
          setView('day')
        }}
        onStep={page}
      />
    )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <Toolbar onCreate={createNow} />
      {shown.length > 0 && data?.truncated && (
        <p className='bg-muted text-muted-foreground px-3 py-1 text-sm'>
          {t`Too many events to show them all. Choose a shorter range.`}
        </p>
      )}
      <div className='min-h-0 flex-1'>{grid}</div>

      <EventSummaryPanel
        instance={selected}
        zones={preferences.zones}
        onClose={() => setSelected(null)}
        onCopy={(instance) => void copyOccurrence(instance)}
      />

      <ScopeDialog
        open={moving !== null}
        title={moving?.copy ? t`Copy this event` : t`Move this event`}
        icon={<Check className='size-4' />}
        onOpenChange={(open) => {
          if (!open) setMoving(null)
        }}
        onChoose={(scope) => {
          const run = moving?.run
          setMoving(null)
          run?.(scope)
        }}
      />
    </div>
  )
}
