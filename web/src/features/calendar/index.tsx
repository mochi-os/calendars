// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback, useMemo, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  addDays,
  dayList,
  dayOfWeek,
  MonthGrid,
  monthOf,
  stepDate,
  TimeGrid,
  useFormat,
  usePageTitle,
  useShellStorage,
  offsetLabel,
  type CalendarEvent,
} from '@mochi/web'
import { Check } from 'lucide-react'
import type { Instance } from '@/api/types/events'
import { emptyRepeat, type EventDraft, type Scope } from '@/lib/ical'
import { useCalendarContext } from '@/context/calendar-context'
import { useEventMove } from '@/hooks/use-event-move'
import { useInstancesQuery } from '@/hooks/use-events'
import { Agenda } from '@/features/calendar/components/agenda'
import { DayPopover } from '@/features/calendar/components/day-popover'
import { EventPopover } from '@/features/calendar/components/event-popover'
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
    setEditing,
  } = useCalendarContext()

  const [lastCalendar, setLastCalendar] = useShellStorage<string>(
    'calendars:last',
    ''
  )
  const [selected, setSelected] = useState<{
    instance: Instance
    anchor: DOMRect
  } | null>(null)
  const [overflow, setOverflow] = useState<{
    day: string
    anchor: DOMRect
  } | null>(null)
  const [moving, setMoving] = useState<{
    run: (scope: Scope) => void
    copy: boolean
  } | null>(null)

  const mover = useEventMove()

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
  const { data } = useInstancesQuery(start, finish, shown, format.timezone)
  // A calendar's colour comes from the calendar list, so recolouring one is
  // seen at once rather than when the range is fetched again.
  const colours = useMemo(
    () => new Map(calendars.map((c) => [c.id, c.colour])),
    [calendars]
  )
  const instances = useMemo(
    () =>
      shown.length === 0
        ? []
        : (data?.instances ?? []).map((instance) => ({
            ...instance,
            colour: colours.get(instance.calendar) ?? instance.colour,
          })),
    [shown.length, data?.instances, colours]
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

  const calendarFor = useCallback(() => {
    const writable = calendars.filter((calendar) => !calendar.readonly)
    const last = writable.find((calendar) => calendar.id === lastCalendar)
    return (last ?? writable.find((c) => c.default) ?? writable[0])?.id ?? ''
  }, [calendars, lastCalendar])

  const compose = useCallback(
    (from: number, to: number, allday = false): EventDraft => {
      const calendar = calendarFor()
      setLastCalendar(calendar)
      return {
        title: '',
        calendar,
        allday,
        start: format.zonedDay(new Date(from * 1000)),
        startTime: format.zonedMinutes(new Date(from * 1000)),
        finish: format.zonedDay(new Date(to * 1000)),
        finishTime: format.zonedMinutes(new Date(to * 1000)),
        zone: { start: format.timezone, finish: format.timezone },
        location: '',
        description: '',
        repeat: emptyRepeat(),
        reminder: preferences.reminder,
      }
    },
    [calendarFor, format, preferences.reminder, setLastCalendar]
  )

  // "New event" lands on the next whole hour of today, the length the user set.
  const createNow = () => {
    const now = new Date()
    const hour = Math.min(23, Math.floor(format.zonedMinutes(now) / 60) + 1)
    const from = format.timestampAt(format.zonedDay(now), hour * 60)
    setEditing({
      mode: 'create',
      draft: compose(from, from + preferences.duration * 60),
    })
  }

  const createOnDay = (day: string) => {
    const from = format.timestampAt(day, preferences.hours.start * 60)
    setEditing({
      mode: 'create',
      draft: compose(from, from + preferences.duration * 60),
    })
  }

  // A click opens the editor; a read-only occurrence (a subscription's or a
  // birthday) has nothing to edit, so it opens the summary popover instead.
  const open = (instance: Instance, anchor: HTMLElement) => {
    if (instance.readonly || instance.event.startsWith('birthday-')) {
      setSelected({ instance, anchor: anchor.getBoundingClientRect() })
    } else {
      setEditing({ mode: 'edit', event: instance.event, start: instance.start })
    }
  }

  const select = (key: string, anchor: HTMLElement) => {
    const instance = byKey.get(key)
    if (instance) open(instance, anchor)
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

  const grid =
    view === 'list' ? (
      <Agenda onSelect={open} />
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
        onSelect={select}
        onCreate={(from, to) =>
          setEditing({ mode: 'create', draft: compose(from, to) })
        }
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
        onSelect={select}
        onCreate={createOnDay}
        onMove={({ key, day, copy, calendar }) => {
          const instance = byKey.get(key)
          if (!instance || instance.readonly) return
          const run = calendar
            ? mover.toCalendar(instance, calendar, { copy })
            : mover.toDay(instance, day, { copy })
          requestMove(instance, run, copy)
        }}
        onOverflow={(day) => {
          const cell = document.querySelector(`[data-day="${day}"]`)
          if (cell) {
            setOverflow({ day, anchor: cell.getBoundingClientRect() })
          }
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
      {data?.truncated && (
        <p className='bg-muted text-muted-foreground px-3 py-1 text-sm'>
          {t`Too many events to show them all. Choose a shorter range.`}
        </p>
      )}
      <div className='min-h-0 flex-1'>{grid}</div>

      <EventPopover
        instance={selected?.instance ?? null}
        anchor={selected?.anchor ?? null}
        zones={preferences.zones}
        onClose={() => setSelected(null)}
      />

      <DayPopover
        day={overflow?.day ?? null}
        anchor={overflow?.anchor ?? null}
        instances={instances}
        onClose={() => setOverflow(null)}
        onSelect={(instance, anchor) => {
          setOverflow(null)
          open(instance, anchor)
        }}
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
