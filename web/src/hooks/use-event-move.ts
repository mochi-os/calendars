// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  addDays,
  coveredDays,
  daysBetween,
  getErrorMessage,
  toast,
  useFormat,
  zonedDay,
  zonedMinutes,
} from '@mochi/web'
import { eventsApi } from '@/api/events'
import type { Component, Instance } from '@/api/types/events'
import {
  componentDraft,
  deletedOccurrence,
  draftComponent,
  draftInstants,
  editedComponents,
  emptyRepeat,
  masterComponent,
  occurrenceDraft,
  overrideComponent,
  splitSeries,
  type EventDraft,
  type Scope,
} from '@/lib/ical'
import {
  useCreateEventMutation,
  useDeleteEventMutation,
  useSplitEventMutation,
  useUpdateEventMutation,
} from '@/hooks/use-events'

/** What a drag asks for beyond a new time: a copy, or another calendar. */
export interface MoveOptions {
  copy?: boolean
  calendar?: string
}

/** A component describing one occurrence alone, with nothing of a series on it. */
function single(draft: EventDraft, previous?: Component): Component {
  const series = new Set(['RECURRENCE-ID', 'RRULE', 'RDATE', 'EXDATE'])
  const component = draftComponent(
    { ...draft, repeat: emptyRepeat() },
    previous
  )
  return {
    ...component,
    properties: component.properties.filter((item) => !series.has(item.name)),
  }
}

/**
 * Dragging an occurrence to a new time, day or calendar, or copying it
 * there. The stored event is read first: a move rewrites the same component
 * the editor would, so a series keeps its rule and an override keeps being
 * an override. Every write says what it did, with a way back.
 */
export function useEventMove() {
  const { t } = useLingui()
  const format = useFormat()
  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const deleteMutation = useDeleteEventMutation()
  const splitMutation = useSplitEventMutation()

  const done = (message: string, undo: () => Promise<unknown>) => {
    toast.success(message, {
      action: {
        label: t`Undo`,
        onClick: () => {
          undo().catch((error: unknown) => {
            toast.error(getErrorMessage(error, t`Failed to undo`))
          })
        },
      },
    })
  }

  const apply = async (
    instance: Instance,
    scope: Scope,
    change: (draft: EventDraft) => EventDraft,
    options: MoveOptions = {}
  ) => {
    try {
      const { event } = await eventsApi.get(instance.event)
      const master = masterComponent(event.components)
      if (!master) return
      const zone = format.timezone
      const override = overrideComponent(event.components, instance.start, zone)
      const own = override ?? master
      const target = options.calendar ?? event.calendar
      const restore = (etag: string) =>
        updateMutation.mutateAsync({
          event: event.id,
          etag,
          calendar: event.calendar,
          components: event.components,
        })
      const remove = (created: { id: string; etag: string }) =>
        deleteMutation.mutateAsync({ event: created.id, etag: created.etag })

      // This occurrence and the ones after it: the series is cut there. The
      // first occurrence has nothing before it, so that is the whole series.
      if (scope === 'following' && event.recurring) {
        const draft = change(
          occurrenceDraft(master, instance.start, target, zone)
        )
        const split = splitSeries(event.components, draft, instance.start, zone)
        if (split) {
          const { event: kept, following } = await splitMutation.mutateAsync({
            event: event.id,
            etag: event.etag,
            start: instance.start,
            components: split.before,
            following: split.after,
            calendar: target,
            copy: options.copy,
          })
          if (options.copy) {
            done(t`Event copied`, () => remove(following))
          } else {
            done(t`Event moved`, async () => {
              await remove(following)
              await restore(kept.etag)
            })
          }
          return
        }
        scope = 'all'
      }

      // The draft a change starts from: the whole series reads from its
      // master, one occurrence from its own override or, failing one, from
      // the master moved onto it, so a change by a day or an hour lands where
      // the occurrence is rather than where the series began.
      const base =
        scope === 'all' || !event.recurring
          ? componentDraft(master, target, zone)
          : override
            ? componentDraft(override, target, zone)
            : occurrenceDraft(master, instance.start, target, zone)
      const draft = change(base)

      if (options.copy) {
        // A copy of this occurrence alone, or of the whole series.
        const components =
          scope === 'all' && event.recurring
            ? editedComponents(
                event.components,
                draft,
                'all',
                instance.start,
                zone
              )
            : [single(draft, own)]
        const { event: created } = await createMutation.mutateAsync({
          calendar: target,
          components,
        })
        done(t`Event copied`, () => remove(created))
        return
      }

      // One occurrence of a series moved to another calendar leaves the
      // series behind as an exception and becomes an event of its own there.
      if (
        scope === 'one' &&
        event.recurring &&
        options.calendar &&
        options.calendar !== event.calendar
      ) {
        const { event: created } = await createMutation.mutateAsync({
          calendar: target,
          components: [single(draft, own)],
        })
        const components = deletedOccurrence(
          event.components,
          instance.start,
          zone
        )
        if (!components) return
        const { event: written } = await updateMutation.mutateAsync({
          event: event.id,
          etag: event.etag,
          components,
        })
        done(t`Event moved`, async () => {
          await remove(created)
          await restore(written.etag)
        })
        return
      }

      const components = event.recurring
        ? editedComponents(event.components, draft, scope, instance.start, zone)
        : [draftComponent(draft, own)]
      const { event: written } = await updateMutation.mutateAsync({
        event: event.id,
        etag: event.etag,
        calendar: target,
        components,
      })
      done(t`Event moved`, () => restore(written.etag))
    } catch (error) {
      if ((error as { status?: number })?.status === 412) {
        toast.error(t`This event changed somewhere else.`)
        return
      }
      toast.error(
        getErrorMessage(
          error,
          options.copy
            ? t`Failed to copy the event`
            : t`Failed to move the event`
        )
      )
    }
  }

  /**
   * A block dragged or resized in the day and week views, in unix seconds.
   * The draft moves by as much as the occurrence did, so a whole series
   * shifts rather than jumping onto the occurrence, and takes the new length.
   */
  const toTime =
    (
      instance: Instance,
      start: number,
      finish: number,
      options?: MoveOptions
    ) =>
    (scope: Scope) =>
      apply(
        instance,
        scope,
        (draft) => {
          const begins = draftInstants(draft).start + (start - instance.start)
          const at = new Date(begins * 1000)
          const to = new Date((begins + (finish - start)) * 1000)
          return {
            ...draft,
            allday: false,
            start: zonedDay(at, draft.zone.start),
            startTime: zonedMinutes(at, draft.zone.start),
            finish: zonedDay(to, draft.zone.finish),
            finishTime: zonedMinutes(to, draft.zone.finish),
          }
        },
        options
      )

  /** A chip dragged onto another day in the month and multiweek views. */
  const toDay =
    (instance: Instance, day: string, options?: MoveOptions) =>
    (scope: Scope) =>
      apply(
        instance,
        scope,
        (draft) => {
          const from = coveredDays(instance, (date, own) =>
            zonedDay(date, own || draft.zone.start)
          ).start
          const shift = daysBetween(from, day)
          if (shift === 0) return draft
          return {
            ...draft,
            start: addDays(draft.start, shift),
            finish: addDays(draft.finish, shift),
          }
        },
        options
      )

  /**
   * A block dragged into the all-day band: it becomes all-day on that day,
   * covering as many days as it did.
   */
  const toAllday =
    (instance: Instance, day: string, options?: MoveOptions) =>
    (scope: Scope) =>
      apply(
        instance,
        scope,
        (draft) => {
          const covered = coveredDays(instance, (date, own) =>
            zonedDay(date, own || draft.zone.start)
          )
          const length = Math.max(0, daysBetween(covered.start, covered.finish))
          const first = addDays(draft.start, daysBetween(covered.start, day))
          return {
            ...draft,
            allday: true,
            start: first,
            finish: addDays(first, length),
          }
        },
        options
      )

  /** A block dropped on a calendar's row: it moves there as it is. */
  const toCalendar =
    (instance: Instance, calendar: string, options?: MoveOptions) =>
    (scope: Scope) =>
      apply(instance, scope, (draft) => draft, { ...options, calendar })

  return {
    toTime,
    toDay,
    toAllday,
    toCalendar,
    isPending:
      updateMutation.isPending ||
      createMutation.isPending ||
      splitMutation.isPending,
  }
}
