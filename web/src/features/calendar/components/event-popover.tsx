// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  coveredDays,
  descriptionText,
  flightNumber,
  useFormat,
  useLinks,
} from '@mochi/web'
import { Clock, MapPin, Plane, TextAlignStart } from 'lucide-react'
import type { Instance } from '@/api/types/events'

interface Props {
  instance: Instance | null
  /** Where the block that was clicked sits on screen. */
  anchor: DOMRect | null
  onClose: () => void
}

/** The first few lines of a description; the editor shows the whole thing. */
const DESCRIPTION_HEAD = 240

export function EventPopover({ instance, anchor, onClose }: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const links = useLinks()
  if (!instance || !anchor) return null

  const start = new Date(instance.start * 1000)
  const finish = new Date(instance.finish * 1000)
  const lastDay = new Date(Math.max(instance.start, instance.finish - 1) * 1000)
  const oneDay = format.zonedDay(start) === format.zonedDay(lastDay)

  let span: string
  if (instance.allday) {
    // By the days the occurrence covers, not its instants, so the dates read
    // the same in every zone.
    const days = coveredDays(instance, format.zonedDay)
    const first = new Date(format.timestampAt(days.start, 720) * 1000)
    const last = new Date(format.timestampAt(days.finish, 720) * 1000)
    span =
      days.start === days.finish
        ? format.formatLongDate(first)
        : format.formatDayRange(first, last)
  } else if (oneDay) {
    const day = format.formatLongDate(start)
    const from = format.formatClock(start)
    const to = format.formatClock(finish)
    span = t`${day}, ${from} to ${to}`
  } else {
    const from = `${format.formatLongDate(start)} ${format.formatClock(start)}`
    const to = `${format.formatLongDate(finish)} ${format.formatClock(finish)}`
    span = t`${from} to ${to}`
  }

  // A subscription's description may be HTML, as Google's are; the summary
  // shows its text.
  const text = descriptionText(instance.description)
  const description = text.slice(0, DESCRIPTION_HEAD)
  // A location that is a flight number opens on the user's flight tracker;
  // anything else opens as a map search.
  const flight = flightNumber(instance.location)

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className='pointer-events-none fixed'
          style={{
            left: `${anchor.left}px`,
            top: `${anchor.top}px`,
            width: `${anchor.width}px`,
            height: `${anchor.height}px`,
          }}
        />
      </PopoverAnchor>
      <PopoverContent align='start' className='w-80 space-y-2'>
        {/* Every row leads with a 16px glyph and the same gap, so the title,
            the span, the location and the description align in one column. */}
        <div className='flex items-start gap-1.5'>
          <span
            aria-hidden
            className='mt-0.5 flex size-4 shrink-0 items-center justify-center'
          >
            <span
              className='size-3 rounded-full'
              style={{ backgroundColor: instance.colour }}
            />
          </span>
          <h2 className='min-w-0 flex-1 font-semibold break-words'>
            {instance.summary}
          </h2>
        </div>
        <p className='text-muted-foreground flex items-start gap-1.5 text-sm'>
          <Clock className='mt-0.5 size-4 shrink-0' aria-hidden />
          <span className='min-w-0'>{span}</span>
        </p>
        {instance.location && (
          <p className='flex items-start gap-1.5 text-sm'>
            {flight ? (
              <Plane className='mt-0.5 size-4 shrink-0' aria-hidden />
            ) : (
              <MapPin className='mt-0.5 size-4 shrink-0' aria-hidden />
            )}
            {/* In a new tab: the shell's sandbox allows popups, so a plain
                anchor is enough. */}
            <a
              href={
                flight ? links.flight(flight) : links.map(instance.location)
              }
              target='_blank'
              rel='noopener noreferrer'
              className='text-primary min-w-0 break-words underline-offset-4 hover:underline'
            >
              {instance.location}
            </a>
          </p>
        )}
        {description && (
          <p className='flex items-start gap-1.5 text-sm'>
            <TextAlignStart className='mt-0.5 size-4 shrink-0' aria-hidden />
            <span className='min-w-0 break-words whitespace-pre-wrap'>
              {description}
              {text.length > DESCRIPTION_HEAD ? '…' : ''}
            </span>
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
