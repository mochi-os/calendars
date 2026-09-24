// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  coveredDays,
  descriptionText,
  flightNumber,
  useFormat,
  useLinks,
  zoneCity,
} from '@mochi/web'
import { Clock, Copy, MapPin, Plane, TextAlignStart } from 'lucide-react'
import type { Instance } from '@/api/types/events'

interface Props {
  instance: Instance | null
  /** Where the block that was clicked sits on screen. */
  anchor: DOMRect | null
  /** Whether the views show events in their own zones. */
  zones?: boolean
  onClose: () => void
  /** Opens the editor on a new event copied from this occurrence. */
  onCopy?: (instance: Instance) => void
}

/** The first few lines of a description; the editor shows the whole thing. */
const DESCRIPTION_HEAD = 240

export function EventPopover({
  instance,
  anchor,
  zones = false,
  onClose,
  onCopy,
}: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const links = useLinks()
  if (!instance || !anchor) return null

  const start = new Date(instance.start * 1000)
  const finish = new Date(instance.finish * 1000)
  const lastDay = new Date(Math.max(instance.start, instance.finish - 1) * 1000)
  // The zones the ends were written in, when they are not the user's own.
  const startZone = instance.zone?.start || undefined
  const finishZone = instance.zone?.finish || undefined
  const foreign =
    !instance.allday &&
    ((startZone !== undefined && startZone !== format.timezone) ||
      (finishZone !== undefined && finishZone !== format.timezone))

  // The span read in a pair of zones, the user's own when none is given.
  // With cities, each end names the city of its zone: "10:00 London to
  // 13:00 New York".
  const describe = (
    at: { start?: string; finish?: string },
    cities: boolean
  ) => {
    const label = (zone?: string) =>
      cities ? ` ${zoneCity(zone ?? format.timezone)}` : ''
    const oneDay =
      format.zonedDay(start, at.start) === format.zonedDay(lastDay, at.finish)
    if (oneDay) {
      const day = format.formatLongDate(start, at.start)
      const from = `${format.formatClock(start, at.start)}${label(at.start)}`
      const to = `${format.formatClock(finish, at.finish)}${label(at.finish)}`
      return t`${day}, ${from} to ${to}`
    }
    const from = `${format.formatLongDate(start, at.start)} ${format.formatClock(start, at.start)}${label(at.start)}`
    const to = `${format.formatLongDate(finish, at.finish)} ${format.formatClock(finish, at.finish)}${label(at.finish)}`
    return t`${from} to ${to}`
  }

  let span: string
  // The span in the ends' own zones, beneath the user's when the views keep
  // the user's zone, and the span itself when they show events in theirs.
  let own = ''
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
  } else if (zones && foreign) {
    span = describe({ start: startZone, finish: finishZone }, true)
  } else {
    span = describe({}, false)
    if (foreign) own = describe({ start: startZone, finish: finishZone }, true)
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
        {own && (
          <p className='text-muted-foreground flex items-start gap-1.5 text-sm'>
            <span aria-hidden className='mt-0.5 size-4 shrink-0' />
            <span className='min-w-0'>{own}</span>
          </p>
        )}
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
        {onCopy && (
          <div className='flex justify-end pt-1'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onCopy(instance)}
            >
              <Copy className='size-4' />
              <Trans>Copy</Trans>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
