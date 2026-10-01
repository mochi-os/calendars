// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMemo } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  cn,
  coveredDays,
  EmptyState,
  EventDot,
  EventTitle,
  finished,
  monthOf,
  naturalCompare,
  useFormat,
  weekRows,
  type CalendarEvent,
} from '@mochi/web'
import { Bell, CalendarDays, Repeat, Repeat2 } from 'lucide-react'

// A phone has no room for titles in a month's cells, so each day shows up to
// this many dots and the chosen day's events are listed under the month.
const DOTS = 3

export interface PhoneMonthProps {
  /** The days shown; a whole number of weeks. */
  days: string[]
  /** The anchored month, 1 through 12; days outside it are dimmed. */
  month: number
  events: CalendarEvent[]
  today: string
  /** The chosen day, whose events are listed. */
  date: string
  onDate: (day: string) => void
  /** The occurrence whose summary or editor is open, drawn tinted. */
  selected?: string
  onSelect: (key: string, anchor: HTMLElement) => void
}

export function PhoneMonth({
  days,
  month,
  events,
  today,
  date,
  onDate,
  selected,
  onSelect,
}: PhoneMonthProps) {
  const { t } = useLingui()
  const format = useFormat()
  const rows = useMemo(
    () => weekRows(days[0] ?? today, days.length),
    [days, today]
  )

  // Each day's occurrences, all-day before timed, then by start and title,
  // the order the month grid draws them in.
  const lists = useMemo(() => {
    const out = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const covered = coveredDays(event, format.zonedDay)
      for (const day of days) {
        if (day < covered.start || day > covered.finish) continue
        const list = out.get(day) ?? []
        list.push(event)
        out.set(day, list)
      }
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          Number(b.allday) - Number(a.allday) ||
          a.start - b.start ||
          naturalCompare(a.title, b.title)
      )
    }
    return out
  }, [events, days, format])

  const noon = (day: string) => new Date(format.timestampAt(day, 720) * 1000)
  const chosen = lists.get(date) ?? []

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='shrink-0 border-b px-1 pb-1'>
        <div className='grid grid-cols-7'>
          {(rows[0] ?? []).map((day) => (
            <span
              key={day}
              className='text-muted-foreground py-1 text-center text-xs'
            >
              {format.formatWeekdayShort(noon(day))}
            </span>
          ))}
        </div>
        {rows.map((week) => (
          <div key={week[0]} className='grid grid-cols-7'>
            {week.map((day) => {
              const list = lists.get(day) ?? []
              return (
                <button
                  key={day}
                  type='button'
                  data-day={day}
                  aria-label={format.formatLongDate(noon(day))}
                  aria-pressed={day === date}
                  onClick={() => onDate(day)}
                  className='flex h-12 flex-col items-center justify-start gap-1 pt-1'
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-sm',
                      monthOf(day) !== month && 'text-muted-foreground',
                      day === date && 'bg-muted font-semibold',
                      day === today &&
                        'bg-primary text-primary-foreground font-semibold'
                    )}
                  >
                    {format.formatDayNumber(noon(day))}
                  </span>
                  <span className='flex h-1.5 items-center gap-0.5'>
                    {list.slice(0, DOTS).map((event) => (
                      <EventDot
                        key={event.key}
                        event={event}
                        className='size-1.5'
                      />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <h2
          className={cn(
            'sticky top-0 px-3 py-1.5 text-sm font-semibold',
            date === today
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/60'
          )}
        >
          {format.formatLongDate(noon(date))}
        </h2>
        {chosen.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t`No events`} />
        ) : (
          <ul>
            {chosen.map((event) => (
              <li key={event.key}>
                <button
                  type='button'
                  data-key={event.key}
                  onClick={(pointer) =>
                    onSelect(event.key, pointer.currentTarget)
                  }
                  className={cn(
                    'hover:bg-hover flex w-full items-center gap-3 border-b px-3 py-2.5 text-start',
                    (event.status === 'cancelled' ||
                      finished(
                        event,
                        Date.now() / 1000,
                        today,
                        format.zonedDay
                      )) &&
                      'opacity-60',
                    event.key === selected && 'bg-primary/10'
                  )}
                >
                  <EventDot event={event} className='size-3' />
                  <EventTitle event={event} className='flex-1 font-medium' />
                  {event.alarm && (
                    <Bell
                      className='size-3.5 shrink-0 opacity-70'
                      aria-label={t`Reminder`}
                    />
                  )}
                  {event.exception ? (
                    <Repeat2
                      className='size-3.5 shrink-0 opacity-70'
                      aria-label={t`Changed occurrence`}
                    />
                  ) : event.recurring ? (
                    <Repeat
                      className='size-3.5 shrink-0 opacity-70'
                      aria-label={t`Repeats`}
                    />
                  ) : null}
                  {!event.allday && (
                    <span className='text-muted-foreground shrink-0 text-sm'>
                      {format.formatClock(
                        new Date(event.start * 1000),
                        event.zone?.start
                      )}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
