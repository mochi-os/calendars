// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import {
  addDays,
  dayList,
  dayOfWeek,
  eventStatus,
  getErrorMessage,
  MonthGrid,
  monthOf,
  stepDate,
  TimeGrid,
  useFormat,
  usePageTitle,
  toast,
  offsetLabel,
  type CalendarEvent,
} from '@mochi/web'
import { Check } from 'lucide-react'
import { eventsApi } from '@/api/events'
import type { Component, Instance } from '@/api/types/events'
import {
  creationDay,
  copyDraft,
  defaultCalendar,
  defaultStart,
  instanceDraft,
  newDraft,
  type EventDraft,
  type Scope,
} from '@/lib/ical'
import { useCalendarContext } from '@/context/calendar-context'
import { useCalendarShortcuts } from '@/hooks/use-calendar-shortcuts'
import { useEventMove } from '@/hooks/use-event-move'
import { useInstancesQuery } from '@/hooks/use-events'
import { Agenda } from '@/features/calendar/components/agenda'
import { DeleteEventDialog } from '@/features/calendar/components/delete-event-dialog'
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
    editing,
    setEditing,
    remembered,
    reveal,
  } = useCalendarContext()

  const [selected, setSelected] = useState<{
    instance: Instance
    anchor: DOMRect
  } | null>(null)
  const [moving, setMoving] = useState<{
    run: (scope: Scope) => void
    copy: boolean
  } | null>(null)
  const [deleting, setDeleting] = useState<Instance | null>(null)
  const [copying, setCopying] = useState<{
    instance: Instance
    components: Component[]
  } | null>(null)

  const mover = useEventMove(reveal)

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

  // A Copy waits on its event. Anything opened meanwhile (another quick view,
  // an editor, a new event) or leaving the page counts it out, so a late answer
  // never replaces what the user moved on to.
  const copyRequest = useRef(0)
  useEffect(() => {
    if (editing) copyRequest.current++
  }, [editing])
  useEffect(
    () => () => {
      copyRequest.current++
    },
    []
  )

  // A click opens the quick view. Own events offer edit, delete and copy;
  // subscriptions and birthdays offer only a copy into a writable calendar.
  const open = (instance: Instance, anchor: HTMLElement) => {
    copyRequest.current++
    setSelected({ instance, anchor: anchor.getBoundingClientRect() })
  }

  const copyOwn = async (instance: Instance) => {
    setSelected(null)
    const request = ++copyRequest.current
    try {
      const { event } = await eventsApi.get(instance.event)
      if (request !== copyRequest.current) return
      if (instance.recurring) {
        setCopying({ instance, components: event.components })
      } else {
        const draft = copyDraft(
          event.components,
          instance.start,
          instance.calendar,
          format.timezone,
          'one'
        )
        if (draft) setEditing({ mode: 'create', draft, copy: true })
      }
    } catch (error) {
      if (request !== copyRequest.current) return
      toast.error(getErrorMessage(error, t`Failed to copy the event`))
    }
  }

  const finishCopy = (scope: 'one' | 'all') => {
    if (!copying) return
    const { instance, components } = copying
    const draft = copyDraft(
      components,
      instance.start,
      instance.calendar,
      format.timezone,
      scope
    )
    setCopying(null)
    if (draft) setEditing({ mode: 'create', draft, copy: true })
  }

  // The occurrence whose summary or editor is open, which the views tint.
  const current = selected
    ? `${selected.instance.event}:${selected.instance.start}`
    : editing?.mode === 'edit'
      ? `${editing.event}:${editing.start}`
      : undefined

  // A reminder opens the calendar at the event it is for: once the day's
  // occurrences arrive it opens as a click on it would, and leaves the URL so
  // going back does not open it again.
  const search = useSearch({ strict: false }) as {
    event?: string
    occurrence?: number
  }
  const navigate = useNavigate()
  useEffect(() => {
    if (!search.event) return
    const key = `${search.event}:${search.occurrence ?? 0}`
    const instance = instances.find(
      (item) => `${item.event}:${item.start}` === key
    )
    if (!instance) return
    const anchor =
      document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ??
      document.body
    open(instance, anchor)
    void navigate({
      to: '.',
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        event: undefined,
        occurrence: undefined,
      }),
      replace: true,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open reads state only
  }, [search.event, search.occurrence, instances])

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

  useCalendarShortcuts({
    blocked: Boolean(editing || selected || moving || deleting || copying),
    today: () => setDate(today),
    page,
    create: createNow,
    view: setView,
    search: () => document.getElementById('calendar-search')?.focus(),
  })

  const grid =
    view === 'list' ? (
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
        onEdit={
          selected && !selected.instance.readonly
            ? (instance) => {
                setSelected(null)
                setEditing({
                  mode: 'edit',
                  event: instance.event,
                  start: instance.start,
                })
              }
            : undefined
        }
        onDelete={
          selected && !selected.instance.readonly
            ? (instance) => {
                setSelected(null)
                setDeleting(instance)
              }
            : undefined
        }
        onCopyOwn={
          selected && !selected.instance.readonly
            ? (instance) => void copyOwn(instance)
            : undefined
        }
        onCopy={
          selected?.instance.readonly
            ? (instance) => {
                // A read-only occurrence has no event the editor could read, so
                // the copy is what the listing says of it, in the user's calendar.
                setSelected(null)
                const calendar = calendarFor()
                setEditing({
                  mode: 'create',
                  draft: instanceDraft(
                    instance,
                    calendar,
                    preferences.reminder,
                    format.timezone
                  ),
                  copy: true,
                })
              }
            : undefined
        }
      />

      <DeleteEventDialog
        event={deleting?.event ?? null}
        start={deleting?.start ?? 0}
        recurring={deleting?.recurring}
        onClose={() => setDeleting(null)}
        onDeleted={() => setDeleting(null)}
      />

      <ScopeDialog
        open={copying !== null}
        title={t`Copy this event`}
        recurring={Boolean(copying?.instance.recurring)}
        following={false}
        onOpenChange={(next) => {
          if (!next) setCopying(null)
        }}
        onChoose={(scope) => finishCopy(scope === 'all' ? 'all' : 'one')}
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
