// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  useFormat,
} from '@mochi/web'
import type { Instance } from '@/api/types/events'
import { useCalendarContext } from '@/context/calendar-context'

interface Props {
  /** The day whose occurrences are listed, or null when none is open. */
  day: string | null
  anchor: DOMRect | null
  instances: Instance[]
  onClose: () => void
  onSelect: (instance: Instance, anchor: HTMLElement) => void
}

/** Everything on one day, opened from a grid cell's "+N more". */
export function DayPopover({
  day,
  anchor,
  instances,
  onClose,
  onSelect,
}: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { preferences } = useCalendarContext()
  if (!day || !anchor) return null

  const list = instances
    .filter(
      (instance) =>
        format.zonedDay(new Date(instance.start * 1000)) <= day &&
        format.zonedDay(
          new Date(Math.max(instance.start, instance.finish - 1) * 1000)
        ) >= day
    )
    .sort((a, b) => Number(b.allday) - Number(a.allday) || a.start - b.start)

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
      <PopoverContent align='start' className='w-72 p-2'>
        <h2 className='px-1 pb-1 text-sm font-semibold'>
          {format.formatLongDate(
            new Date(format.timestampAt(day, 720) * 1000)
          )}
        </h2>
        <ul className='max-h-72 overflow-y-auto'>
          {list.map((instance) => (
            <li key={`${instance.event}:${instance.start}`}>
              <button
                type='button'
                onClick={(pointer) => onSelect(instance, pointer.currentTarget)}
                className='hover:bg-hover flex w-full items-center gap-2 rounded-sm px-1 py-1 text-start text-sm'
              >
                <span
                  aria-hidden
                  className='size-2.5 shrink-0 rounded-full'
                  style={{ backgroundColor: instance.colour }}
                />
                <span className='text-muted-foreground shrink-0'>
                  {instance.allday
                    ? t`All day`
                    : format.formatClock(
                        new Date(instance.start * 1000),
                        preferences.zones ? instance.zone?.start : undefined
                      )}
                </span>
                <span className='min-w-0 flex-1 truncate'>
                  {instance.summary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
