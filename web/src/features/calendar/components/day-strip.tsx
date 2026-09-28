// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useRef } from 'react'
import { formatHour, useLocale } from '@mochi/web'
import { moved, placed, resized, type Block } from '@/lib/strip'

/** The width of an hour on the strip, in pixels. */
export const HOUR = 48

const x = (minutes: number) => (minutes / 60) * HOUR

/**
 * The event's day on one line beneath its times: the user's other events
 * that day drawn faintly, the event itself a block that drags to move and
 * stretches from its end, and a click on the rest of the day moving it
 * there, all on five-minute steps. It opens on the working hours. The fields
 * above it are the keyboard's way to the same times, so the strip itself is
 * hidden from assistive technology. It reads left to right in every
 * language, as a ruler does.
 */
export function DayStrip({
  start,
  finish,
  colour,
  others,
  hours,
  onMove,
  onResize,
}: {
  /** The event's start and end, minutes since midnight. */
  start: number
  finish: number
  colour: string
  others: Block[]
  /** The working hours, as whole hours of the day. */
  hours: { start: number; finish: number }
  onMove: (start: number) => void
  onResize: (finish: number) => void
}) {
  const { timeFormat } = useLocale().locale
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    kind: 'move' | 'resize'
    x: number
    start: number
    finish: number
  } | null>(null)

  // Open on the working hours, or on the event where it starts before them.
  useEffect(() => {
    const first = Math.min(hours.start * 60, Math.max(0, start - 60))
    if (scroller.current) scroller.current.scrollLeft = x(first)
    // Only when the strip first shows: a later scroll is the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grab =
    (kind: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>) => {
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { kind, x: event.clientX, start, finish }
    }

  const follow = (event: React.PointerEvent<HTMLElement>) => {
    const held = drag.current
    if (!held) return
    const delta = ((event.clientX - held.x) / HOUR) * 60
    if (held.kind === 'move')
      onMove(moved(held.start, held.finish, delta).start)
    else onResize(resized(held.start, held.finish, delta))
  }

  const release = () => {
    drag.current = null
  }

  // A press on the day beside the event moves the event there.
  const place = (event: React.PointerEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left
    const at = ((event.clientX - left) / HOUR) * 60
    onMove(placed(start, finish, at).start)
  }

  const label = (hour: number) =>
    formatHour(new Date(Date.UTC(2000, 0, 1, hour)), timeFormat, 'UTC')

  return (
    <div
      ref={scroller}
      dir='ltr'
      aria-hidden
      data-testid='day-strip'
      className='overflow-x-auto rounded-lg border'
    >
      <div className='relative h-16' style={{ width: x(24 * 60) }}>
        {/* The hours outside the working day, shaded as the day view does. */}
        <div
          className='bg-muted/50 absolute inset-y-0 start-0'
          style={{ width: x(hours.start * 60) }}
        />
        <div
          className='bg-muted/50 absolute inset-y-0 end-0'
          style={{ width: x((24 - hours.finish) * 60) }}
        />
        {[...Array(24).keys()].map((hour) => (
          <div
            key={hour}
            className='text-muted-foreground absolute inset-y-0 border-s ps-1 text-[10px] leading-5'
            style={{ left: x(hour * 60), width: HOUR }}
          >
            {label(hour)}
          </div>
        ))}
        <div
          data-testid='day-strip-lane'
          className='absolute inset-x-0 top-5 bottom-1 cursor-pointer'
          onPointerDown={place}
        >
          {others.map((block, index) => (
            <div
              key={index}
              title={block.summary}
              className='pointer-events-none absolute inset-y-0 overflow-hidden rounded px-1 text-[10px] leading-4'
              style={{
                left: x(block.start),
                width: x(block.finish - block.start),
                backgroundColor: `color-mix(in srgb, ${block.colour} 25%, transparent)`,
              }}
            >
              <span className='truncate'>{block.summary}</span>
            </div>
          ))}
          <div
            data-testid='day-strip-event'
            className='ring-background absolute inset-y-0 cursor-grab touch-none rounded shadow-sm ring-1 active:cursor-grabbing'
            style={{
              left: x(start),
              width: Math.max(x(finish - start), 6),
              backgroundColor: colour,
            }}
            onPointerDown={grab('move')}
            onPointerMove={follow}
            onPointerUp={release}
            onPointerCancel={release}
          >
            <div
              data-testid='day-strip-end'
              className='absolute inset-y-0 end-0 w-2 cursor-ew-resize'
              onPointerDown={grab('resize')}
              onPointerMove={follow}
              onPointerUp={release}
              onPointerCancel={release}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
