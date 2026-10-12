// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  SidePanel,
  SidePanelBody,
  SidePanelHeader,
  SidePanelTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  coveredDays,
  currentZone,
  descriptionText,
  EventTitle,
  eventStatus,
  flightNumber,
  useEventStatus,
  useFormat,
  useLinks,
  zoneCity,
} from '@mochi/web'
import {
  Ban,
  CircleDashed,
  Clock,
  Copy,
  MapPin,
  Plane,
  TextAlignStart,
} from 'lucide-react'
import type { Instance } from '@/api/types/events'

/**
 * What a read-only occurrence says of itself, a subscription's or a
 * birthday: its title, when it is, its status, where, and what it is about.
 */
export function EventSummary({
  instance,
  zones = false,
}: {
  instance: Instance
  /** Whether the views show events in their own zones. */
  zones?: boolean
}) {
  const { t } = useLingui()
  const format = useFormat()
  const links = useLinks()
  const words = useEventStatus()

  const status = eventStatus(instance.status)
  const state = words(status)
  const start = new Date(instance.start * 1000)
  const finish = new Date(instance.finish * 1000)
  const lastDay = new Date(Math.max(instance.start, instance.finish - 1) * 1000)
  // The zones the ends were written in, when they are not the user's own
  // under any of its names.
  const startZone = instance.zone?.start || undefined
  const finishZone = instance.zone?.finish || undefined
  const user = currentZone(format.timezone)
  const foreign =
    !instance.allday &&
    ((startZone !== undefined && currentZone(startZone) !== user) ||
      (finishZone !== undefined && currentZone(finishZone) !== user))

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
  // shows its text, whole, since a read-only event has no editor to show it.
  const description = descriptionText(instance.description)
  // A location that is a flight number opens on the user's flight tracker;
  // anything else opens as a map search.
  const flight = flightNumber(instance.location)

  return (
    <div className='space-y-2'>
      {/* Every row leads with a 16px glyph and the same gap, so the span, the
        location and the description align in one column. */}
      <p className='text-muted-foreground flex items-start gap-1.5 text-sm'>
        <Clock className='mt-0.5 size-4 shrink-0' aria-hidden />
        <span className='min-w-0'>{span}</span>
      </p>
      {state && (
        <p className='text-muted-foreground flex items-start gap-1.5 text-sm'>
          {status === 'cancelled' ? (
            <Ban className='mt-0.5 size-4 shrink-0' aria-hidden />
          ) : (
            <CircleDashed className='mt-0.5 size-4 shrink-0' aria-hidden />
          )}
          <span className='min-w-0'>{state}</span>
        </p>
      )}
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
            href={flight ? links.flight(flight) : links.map(instance.location)}
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
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * A read-only occurrence in the side panel every event opens in, with only a
 * copy to offer: the copy is the user's own event, which saves as it is
 * edited.
 */
export function EventSummaryPanel({
  instance,
  zones,
  onClose,
  onCopy,
}: {
  instance: Instance | null
  zones?: boolean
  onClose: () => void
  /** Makes a new event of the user's own copied from this occurrence. */
  onCopy?: (instance: Instance) => void
}) {
  const { t } = useLingui()
  return (
    <SidePanel
      open={instance !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size='xl'
      dismissOnOutsideClick
      onOpenAutoFocus={(focus) => focus.preventDefault()}
    >
      {instance && (
        <>
          <SidePanelHeader
            actions={
              onCopy && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-8'
                      aria-label={t`Copy`}
                      onClick={() => onCopy(instance)}
                    >
                      <Copy className='size-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t`Copy`}</TooltipContent>
                </Tooltip>
              )
            }
          >
            <span
              aria-hidden
              className='size-3 shrink-0 rounded-full'
              style={{ backgroundColor: instance.colour }}
            />
            <SidePanelTitle>
              <EventTitle
                event={{
                  title: instance.summary,
                  status: eventStatus(instance.status),
                }}
              />
            </SidePanelTitle>
          </SidePanelHeader>
          <SidePanelBody>
            <EventSummary instance={instance} zones={zones} />
          </SidePanelBody>
        </>
      )}
    </SidePanel>
  )
}
