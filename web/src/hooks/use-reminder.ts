// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect } from 'react'
import { eventsApi } from '@/api/events'
import type { Instance } from '@/api/types/events'

/**
 * A reminder opens the calendar at the event it is for. Once the occurrence
 * is among the loaded ones the link is dropped, so going back does not open
 * it again, and the occurrence then opens as a click on it would: its panel
 * names it in the address afresh, after the drop has landed. When it is not there after
 * the shown calendars' occurrences have loaded, its calendar is hidden: that
 * calendar is shown, and the occurrence opens as it arrives. If its calendar
 * is shown, the occurrence has gone and the link is dropped.
 */
export function useReminder({
  event,
  occurrence,
  instances,
  loading,
  visible,
  reveal,
  open,
  clear,
}: {
  event?: string
  occurrence?: number
  instances: Instance[]
  loading: boolean
  visible: { id: string }[]
  reveal: (calendar: string) => void
  open: (instance: Instance, key: string) => void
  clear: () => void | Promise<unknown>
}) {
  useEffect(() => {
    if (!event) return
    const key = `${event}:${occurrence ?? 0}`
    const instance = instances.find(
      (item) => `${item.event}:${item.start}` === key
    )
    if (instance) {
      void Promise.resolve(clear()).then(() => open(instance, key))
      return
    }
    if (loading) return
    let current = true
    eventsApi.get(event).then(
      ({ event: found }) => {
        if (!current) return
        if (visible.some((calendar) => calendar.id === found.calendar)) {
          clear()
        } else {
          reveal(found.calendar)
        }
      },
      () => {
        if (current) clear()
      }
    )
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks read state only
  }, [event, occurrence, instances, loading])
}
