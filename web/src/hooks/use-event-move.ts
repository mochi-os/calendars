// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  addDays,
  daysBetween,
  getErrorMessage,
  toast,
  useFormat,
  zonedDay,
  zonedMinutes,
} from '@mochi/web'
import { eventsApi } from '@/api/events'
import type { Instance } from '@/api/types/events'
import {
  componentDraft,
  draftComponent,
  editedComponents,
  masterComponent,
  overrideComponent,
  type EventDraft,
  type Scope,
} from '@/lib/ical'
import { useUpdateEventMutation } from '@/hooks/use-events'

/**
 * Dragging an occurrence to a new time. The stored event is read first: a
 * move rewrites the same component the editor would, so a series keeps its
 * rule and an override keeps being an override.
 */
export function useEventMove() {
  const { t } = useLingui()
  const format = useFormat()
  const updateMutation = useUpdateEventMutation()

  const apply = async (
    instance: Instance,
    scope: Scope,
    change: (draft: EventDraft) => EventDraft
  ) => {
    try {
      const { event } = await eventsApi.get(instance.event)
      const own =
        overrideComponent(event.components, instance.start, format.timezone) ??
        masterComponent(event.components)
      if (!own) return
      const draft = change(
        componentDraft(own, event.calendar, format.timezone)
      )
      const components = event.recurring
        ? editedComponents(
            event.components,
            draft,
            scope,
            instance.start,
            format.timezone
          )
        : [draftComponent(draft, own)]
      await updateMutation.mutateAsync({
        event: event.id,
        etag: event.etag,
        components,
      })
    } catch (error) {
      if ((error as { status?: number })?.status === 412) {
        toast.error(t`This event changed somewhere else.`)
        return
      }
      toast.error(getErrorMessage(error, t`Failed to move the event`))
    }
  }

  /** A block dragged or resized in the day and week views. */
  const toTime = (instance: Instance, start: number, finish: number) =>
    (scope: Scope) =>
      apply(instance, scope, (draft) => {
        const zone = draft.timezone
        return {
          ...draft,
          start: zonedDay(new Date(start * 1000), zone),
          startTime: zonedMinutes(new Date(start * 1000), zone),
          finish: zonedDay(new Date(finish * 1000), zone),
          finishTime: zonedMinutes(new Date(finish * 1000), zone),
        }
      })

  /** A chip dragged onto another day in the month and multiweek views. */
  const toDay = (instance: Instance, day: string) => (scope: Scope) =>
    apply(instance, scope, (draft) => {
      const from = zonedDay(new Date(instance.start * 1000), draft.timezone)
      const shift = daysBetween(from, day)
      if (shift === 0) return draft
      return {
        ...draft,
        start: addDays(draft.start, shift),
        finish: addDays(draft.finish, shift),
      }
    })

  return { toTime, toDay, isPending: updateMutation.isPending }
}
