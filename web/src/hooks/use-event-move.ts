// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useRef } from 'react'
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
import type { Component, Event, Instance } from '@/api/types/events'
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
interface MoveOptions {
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

/** Whether a write takes one occurrence of a series into another calendar. */
export function leavesSeries(
  recurring: boolean,
  scope: Scope,
  from: string,
  to?: string
): boolean {
  return scope === 'one' && recurring && Boolean(to) && to !== from
}

/**
 * One occurrence of a series moved to another calendar: it becomes an event
 * of its own there, and the series keeps an exception for it. The exception
 * is built before anything is written, and the copy is taken back if the
 * series then fails to save, so the occurrence is never left in both
 * calendars. Answers the copy and the series as written.
 */
export function useOccurrenceMove() {
  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const deleteMutation = useDeleteEventMutation()
  return async (
    event: Pick<Event, 'id' | 'etag' | 'components'>,
    start: number,
    draft: EventDraft,
    target: string,
    zone: string
  ) => {
    const master = masterComponent(event.components)
    const components = deletedOccurrence(event.components, start, zone)
    if (!master || !components) throw new Error()
    const own = overrideComponent(event.components, start, zone) ?? master
    const { event: created } = await createMutation.mutateAsync({
      calendar: target,
      components: [single(draft, own)],
    })
    try {
      const { event: written } = await updateMutation.mutateAsync({
        event: event.id,
        etag: event.etag,
        components,
      })
      return { created, written }
    } catch (error) {
      await deleteMutation
        .mutateAsync({ event: created.id, etag: created.etag })
        .catch(() => undefined)
      throw error
    }
  }
}

/**
 * Dragging an occurrence to a new time, day or calendar, or copying it
 * there. The stored event is read first: a move rewrites the same component
 * the editor would, so a series keeps its rule and an override keeps being
 * an override. Every write says what it did, with a way back.
 */
export function useEventMove({
  reveal,
  zones = false,
}: {
  reveal?: (calendar: string) => void
  // Whether the grids draw each event in its own zone, as the preference says.
  zones?: boolean
} = {}) {
  const { t } = useLingui()
  const format = useFormat()
  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const deleteMutation = useDeleteEventMutation()
  const splitMutation = useSplitEventMutation()
  const moveOccurrence = useOccurrenceMove()

  // The day an occurrence is drawn on: in its own zone when events show in
  // their own zones, else in the user's, as the grids place it.
  const drawn = (date: Date, own?: string) =>
    zonedDay(date, zones && own ? own : format.timezone)

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

  // One move at a time: a drag made while another is saving waits for it, so
  // it reads the event as that one left it rather than a copy gone stale.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const apply = (
    instance: Instance,
    scope: Scope,
    change: (draft: EventDraft) => EventDraft,
    options: MoveOptions = {}
  ) => {
    const next = queue.current.then(() =>
      perform(instance, scope, change, options)
    )
    queue.current = next
    return next
  }

  const perform = async (
    instance: Instance,
    scope: Scope,
    change: (draft: EventDraft) => EventDraft,
    options: MoveOptions
  ) => {
    try {
      const { event } = await eventsApi.get(instance.event)
      const master = masterComponent(event.components)
      if (!master) return
      const zone = format.timezone
      const override = overrideComponent(event.components, instance.start, zone)
      const own = override ?? master
      const target = options.calendar ?? event.calendar
      // The calendar written to shows again, so the event does not vanish
      // from view as if it had not moved.
      const saved = (message: string, undo: () => Promise<unknown>) => {
        reveal?.(target)
        done(message, undo)
      }
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
            saved(t`Event copied`, () => remove(following))
          } else {
            saved(t`Event moved`, async () => {
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
        saved(t`Event copied`, () => remove(created))
        return
      }

      // One occurrence of a series moved to another calendar leaves the
      // series behind as an exception and becomes an event of its own there.
      if (leavesSeries(event.recurring, scope, event.calendar, options.calendar)) {
        const { created, written } = await moveOccurrence(
          event,
          instance.start,
          draft,
          target,
          zone
        )
        saved(t`Event moved`, async () => {
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
      saved(t`Event moved`, () => restore(written.etag))
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
          const from = coveredDays(instance, drawn).start
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
          const covered = coveredDays(instance, drawn)
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

  return { toTime, toDay, toAllday, toCalendar }
}
