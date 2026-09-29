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
}

/**
 * The list view: every occurrence from the anchor day on, grouped by day,
 * and more as the reader scrolls - earlier pages above, later pages below -
 * until the calendars' first and last events are on the page.
 */
export function Agenda({ selected, onSelect }: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { date, today, calendars, visible, preferences, search } =
    useCalendarContext()
  const shown = useMemo(() => visible.map((c) => c.id), [visible])

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
      out.push({
        start: format.timestampAt(from, 0),
        finish: format.timestampAt(addDays(from, PAGE), 0),
      })
    }
    return out
  }, [span, format])

  const bounds = useBoundsQuery(shown)
  const { instances, pending } = useInstancePages(pages, shown, format.timezone)

  const loadedFrom = pages[0].start
  const loadedTo = pages[pages.length - 1].finish
  const earlier = Boolean(
    bounds.data && bounds.data.first > 0 && bounds.data.first < loadedFrom
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

  const more = useCallback(() => {
    const box = scroller.current
    if (!box || pending || !later || !bottom.current) return
    const frame = box.getBoundingClientRect()
    const rect = bottom.current.getBoundingClientRect()
    if (rect.top <= frame.bottom + 200) {
      setSpan((current) => ({ ...current, after: current.after + 1 }))
    }
  }, [pending, later])

  const loadEarlier = useCallback(() => {
    const box = scroller.current
    if (!box || pending || !earlier) return
    held.current = box.scrollHeight
    seeking.current = instances.length
    setSpan((current) => ({ ...current, before: current.before + 1 }))
  }, [pending, earlier, instances.length])

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

  const empty = !pending && instances.length === 0 && !earlier && !later
  // A search that matched nothing in everything there is to load, which is
  // not the same as a calendar with nothing on it.
  const unmatched =
    search.trim() !== '' && !pending && matches.length === 0 && !later

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
            <div key={day}>
              <h2
                className={cn(
                  'sticky top-0 px-3 py-1.5 text-sm font-semibold',
                  day === today
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/60'
                )}
              >
                {format.formatLongDate(
                  new Date(format.timestampAt(day, 720) * 1000)
                )}
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
                        className={cn(
                          'hover:bg-hover flex w-full items-center gap-3 border-b px-3 py-2.5 text-start',
                          over(instance) && 'opacity-60',
                          key === selected && 'bg-primary/10'
                        )}
                      >
                        <EventDot event={event} className='size-3' />
                        <EventTitle
                          event={event}
                          className='flex-[2] font-medium'
                        />
                        {instance.alarm && (
                          <Bell
                            className='size-3.5 shrink-0 opacity-70'
                            aria-label={t`Reminder`}
                          />
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
                        ) : null}
                        {!instance.allday && (
                          <span className='text-muted-foreground shrink-0 text-sm'>
                            {format.formatClock(
                              new Date(instance.start * 1000),
                              preferences.zones
                                ? instance.zone?.start
                                : undefined
                            )}
                          </span>
                        )}
                        <span className='text-muted-foreground hidden min-w-0 flex-1 truncate text-sm md:block'>
                          {instance.location}
                        </span>
                        <span className='text-muted-foreground hidden w-40 shrink-0 truncate text-sm md:block'>
                          {names.get(instance.calendar) ?? ''}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
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
