// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  EmptyState,
  addDays,
  cn,
  coveredDays,
  EventDot,
  EventTitle,
  eventStatus,
  finished,
  GeneralError,
  useFormat,
} from '@mochi/web'
import {
  Bell,
  CalendarDays,
  ChevronUp,
  Repeat,
  Repeat2,
  Search,
} from 'lucide-react'
import type { Instance } from '@/api/types/events'
import { useCalendarContext } from '@/context/calendar-context'
import { useBoundsQuery, useInstancePages } from '@/hooks/use-events'

// Days per page. A quarter keeps a year of daily events to four requests.
const PAGE = 92
// How far a calendar that never ends is followed past the anchor before the
// list stops adding pages on its own.
const HORIZON = 40

interface Props {
  /** The occurrence whose summary or editor is open, drawn tinted. */
  selected?: string
  onSelect: (instance: Instance, anchor: HTMLElement) => void
  /** Told the day atop the list as it scrolls, for the toolbar. */
  onTop?: (day: string) => void
}

/**
 * The list view: every occurrence from the anchor day on, grouped by day,
 * and more as the reader scrolls - earlier pages above, later pages below -
 * until the calendars' first and last events are on the page.
 */
export function Agenda({ selected, onSelect, onTop }: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { date, today, calendars, visible, preferences, search } =
    useCalendarContext()
  const shown = useMemo(() => visible.map((c) => c.id), [visible])

  /**
   * A day as the list writes one, in its headings and at each end of a span
   * across days: its short weekday and its date in the user's date format,
   * in the order the language puts them. A year-first date leads, with the
   * weekday after it, in brackets in the languages that bracket one.
   */
  const heading = (day: string) => {
    const noon = new Date(format.timestampAt(day, 720) * 1000)
    const weekday = format.formatWeekdayShort(noon)
    const date = format.formatDate(noon)
    return format.dateFormat === 'YYYY-MM-DD'
      ? t({ message: `${date} ${weekday}`, context: 'ISO date' })
      : t`${weekday}, ${date}`
  }

  /** Over already, or cancelled, and drawn quieter. */
  const over = (instance: Instance) =>
    eventStatus(instance.status) === 'cancelled' ||
    finished(instance, Date.now() / 1000, today, format.zonedDay)

  // Pages before and after the anchor day; a new anchor starts again.
  const [span, setSpan] = useState({ anchor: date, before: 0, after: 1 })
  useEffect(() => {
    setSpan({ anchor: date, before: 0, after: 1 })
  }, [date])

  const pages = useMemo(() => {
    const out: { start: number; finish: number }[] = []
    for (let page = -span.before; page < span.after; page++) {
      const from = addDays(span.anchor, page * PAGE)
      // The server lists nothing before 1970, so a page stops there.
      out.push({
        start: Math.max(0, format.timestampAt(from, 0)),
        finish: Math.max(0, format.timestampAt(addDays(from, PAGE), 0)),
      })
    }
    return out
  }, [span, format])

  const bounds = useBoundsQuery(shown)
  const { instances, pending, failed, retry } = useInstancePages(
    pages,
    shown,
    format.timezone
  )

  const loadedFrom = pages[0].start
  const loadedTo = pages[pages.length - 1].finish
  // A first event before 1970, such as a contact's birthday, is below zero;
  // zero alone means there is none.
  const earlier = Boolean(
    bounds.data &&
    bounds.data.first !== 0 &&
    bounds.data.first < loadedFrom &&
    loadedFrom > 0
  )
  const later = Boolean(
    bounds.data &&
    (bounds.data.endless ? span.after < HORIZON : bounds.data.last >= loadedTo)
  )

  const names = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar.name])),
    [calendars]
  )

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle
      ? instances.filter((instance) =>
          [instance.summary, instance.location, instance.description]
            .join('\n')
            .toLowerCase()
            .includes(needle)
        )
      : instances
  }, [instances, search])

  // Grouped under the day each occurrence begins on.
  const days = useMemo(() => {
    const out = new Map<string, Instance[]>()
    for (const instance of matches) {
      const day = coveredDays(
        preferences.zones ? instance : { ...instance, zone: undefined },
        format.zonedDay
      ).start
      const list = out.get(day)
      if (list) list.push(instance)
      else out.set(day, [instance])
    }
    return [...out.entries()]
  }, [matches, format, preferences.zones])

  // When a timed occurrence is: the clock times of a span within a day, or
  // across days each end's day, written as the headings write one, and time,
  // on lines of their own. The ends read in their own zones when the views
  // show events in theirs.
  const when = (instance: Instance) => {
    const zones = preferences.zones ? instance.zone : undefined
    const days = coveredDays(
      preferences.zones ? instance : { ...instance, zone: undefined },
      format.zonedDay
    )
    const from = new Date(instance.start * 1000)
    const to = new Date(instance.finish * 1000)
    if (days.start === days.finish) {
      return format.formatClockRange(from, to, zones)
    }
    const end = (date: Date, zone?: string) =>
      `${heading(format.zonedDay(date, zone))} ${format.formatClock(date, zone)}`
    return format.formatRange(
      end(from, zones?.start),
      end(to, zones?.finish || zones?.start),
      true
    )
  }

  // --- Loading more ---
  //
  // Later pages arrive on their own as the foot of the list comes into view.
  // Earlier pages do not: the head of the list is in view from the start, so
  // they wait for a scroll up at the top, or the button there.

  const scroller = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  // The scroll height before a page was added above, so the reader's place
  // is kept when it lands.
  const held = useRef<number | null>(null)
  const lastTop = useRef(0)
  // How many occurrences were listed when an earlier page was asked for: an
  // empty page would leave nothing to see, so the search carries on to the
  // next one until something lands or the first event is reached.
  const seeking = useRef<number | null>(null)
  // The day last told atop the list, and the anchor it was told under.
  const atop = useRef<{ date: string; day: string } | null>(null)

  // The first day whose rows still reach below the top of the list, told
  // when it or the anchor changes.
  const report = useCallback(() => {
    const box = scroller.current
    if (!box || !onTop) return
    const edge = box.getBoundingClientRect().top
    for (const section of box.querySelectorAll<HTMLElement>('[data-day]')) {
      if (section.getBoundingClientRect().bottom > edge + 1) {
        const day = section.dataset.day ?? ''
        if (atop.current?.day !== day || atop.current.date !== date) {
          atop.current = { date, day }
          onTop(day)
        }
        return
      }
    }
  }, [onTop, date])

  const more = useCallback(() => {
    const box = scroller.current
    if (!box || pending || failed || !later || !bottom.current) return
    const frame = box.getBoundingClientRect()
    const rect = bottom.current.getBoundingClientRect()
    if (rect.top <= frame.bottom + 200) {
      setSpan((current) => ({ ...current, after: current.after + 1 }))
    }
  }, [pending, failed, later])

  const loadEarlier = useCallback(() => {
    const box = scroller.current
    if (!box || pending || failed || !earlier) return
    held.current = box.scrollHeight
    seeking.current = instances.length
    setSpan((current) => ({ ...current, before: current.before + 1 }))
  }, [pending, failed, earlier, instances.length])

  useEffect(() => {
    if (pending || seeking.current === null) return
    const grew = instances.length > seeking.current
    seeking.current = null
    if (!grew) loadEarlier()
  }, [instances, pending, loadEarlier])

  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const observer = new IntersectionObserver(() => more(), {
      root: box,
      rootMargin: '200px',
    })
    if (bottom.current) observer.observe(bottom.current)
    return () => observer.disconnect()
  }, [more])

  // A page that came back short leaves the foot still in view, which the
  // observer does not report again: keep loading until the list overflows,
  // and from then on only as the reader scrolls.
  useEffect(() => {
    const box = scroller.current
    if (box && box.scrollHeight <= box.clientHeight + 1) more()
  }, [instances, more])

  useLayoutEffect(() => {
    const box = scroller.current
    if (held.current !== null && box) {
      box.scrollTop += box.scrollHeight - held.current
      held.current = null
    }
  }, [instances])

  // Days arriving or going move what is at the top as much as a scroll does,
  // and a new anchor wants telling afresh.
  useLayoutEffect(() => report(), [days, report])

  const empty =
    !pending && !failed && instances.length === 0 && !earlier && !later
  // A search that matched nothing in everything there is to load, which is
  // not the same as a calendar with nothing on it.
  const unmatched =
    search.trim() !== '' &&
    !pending &&
    !failed &&
    matches.length === 0 &&
    !later

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div
        ref={scroller}
        className='min-h-0 flex-1 overflow-y-auto'
        onWheel={(wheel) => {
          if (wheel.deltaY < 0 && (scroller.current?.scrollTop ?? 1) <= 0) {
            loadEarlier()
          }
        }}
        onScroll={() => {
          const box = scroller.current
          if (!box) return
          // Reaching the top by touch or scrollbar counts as a scroll up.
          if (box.scrollTop === 0 && lastTop.current > 0) loadEarlier()
          lastTop.current = box.scrollTop
          report()
        }}
      >
        {earlier && (
          <div className='flex justify-center py-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={loadEarlier}
              loading={pending}
              icon={<ChevronUp className='size-4' />}
            >
              {t`Earlier events`}
            </Button>
          </div>
        )}
        {empty ? (
          <EmptyState icon={CalendarDays} title={t`No events`} />
        ) : unmatched ? (
          <EmptyState icon={Search} title={t`No matches`} />
        ) : (
          days.map(([day, list]) => (
            <div key={day} data-day={day}>
              <h2
                className={cn(
                  'sticky top-0 px-3 py-1.5 text-sm font-semibold',
                  day === today
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60'
                )}
              >
                {heading(day)}
              </h2>
              <ul>
                {list.map((instance) => {
                  const key = `${instance.event}:${instance.start}`
                  const event = {
                    title: instance.summary,
                    colour: instance.colour,
                    status: eventStatus(instance.status),
                  }
                  return (
                    <li key={key}>
                      <button
                        type='button'
                        onClick={(pointer) =>
                          onSelect(instance, pointer.currentTarget)
                        }
                        // Columns of a fixed width, the same on every row, so
                        // each one lines up down the list whatever a row holds:
                        // the dot, the title, the time (room for a span across
                        // days on two lines), the location, the calendar and,
                        // last, the marks. An all-day row keeps its empty time
                        // cell, and each mark its own place, empty when the
                        // occurrence has none.
                        className={cn(
                          'hover:bg-hover grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-3 py-2.5 text-start md:grid-cols-[auto_minmax(0,2fr)_12rem_minmax(0,1fr)_10rem_auto]',
                          over(instance) && 'opacity-60',
                          key === selected && 'bg-primary/10'
                        )}
                      >
                        <EventDot event={event} className='size-3' />
                        <EventTitle event={event} className='font-medium' />
                        <span className='text-muted-foreground text-sm whitespace-pre-line'>
                          {instance.allday ? '' : when(instance)}
                        </span>
                        <span className='text-muted-foreground hidden min-w-0 truncate text-sm md:block'>
                          {instance.location}
                        </span>
                        <span className='text-muted-foreground hidden min-w-0 truncate text-sm md:block'>
                          {names.get(instance.calendar) ?? ''}
                        </span>
                        <span className='flex items-center gap-3'>
                          {instance.alarm ? (
                            <Bell
                              className='size-3.5 shrink-0 opacity-70'
                              aria-label={t`Reminder`}
                            />
                          ) : (
                            <span aria-hidden className='size-3.5 shrink-0' />
                          )}
                          {instance.exception ? (
                            <Repeat2
                              className='size-3.5 shrink-0 opacity-70'
                              aria-label={t`Changed occurrence`}
                            />
                          ) : instance.recurring ? (
                            <Repeat
                              className='size-3.5 shrink-0 opacity-70'
                              aria-label={t`Repeats`}
                            />
                          ) : (
                            <span aria-hidden className='size-3.5 shrink-0' />
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
        {failed && (
          <GeneralError mode='inline' className='my-4' reset={retry} />
        )}
        {pending && (
          <p className='text-muted-foreground px-3 py-3 text-sm'>
            {t`Loading...`}
          </p>
        )}
        <div ref={bottom} aria-hidden className='h-px' />
      </div>
    </div>
  )
}
