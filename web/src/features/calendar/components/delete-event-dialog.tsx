// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useRef } from 'react'
import { useLingui } from '@lingui/react/macro'
import { GeneralError, getErrorMessage, toast, useFormat } from '@mochi/web'
import { Trash2 } from 'lucide-react'
import { deletedOccurrence, truncatedSeries, type Scope } from '@/lib/ical'
import {
  useCreateEventMutation,
  useDeleteEventMutation,
  useEventQuery,
  useUpdateEventMutation,
} from '@/hooks/use-events'
import { ScopeDialog } from '@/features/calendar/components/scope-dialog'

interface Props {
  /** The stored event to delete, or null when nothing is being deleted. */
  event: string | null
  /** The occurrence that was clicked, in unix seconds. */
  start: number
  onClose: () => void
  onDeleted?: () => void
}

/**
 * Deletes an event, asking first whether one occurrence or the whole series is
 * meant. Removing one occurrence is an edit of the series: the master gains an
 * exception for it.
 */
export function DeleteEventDialog({ event, start, onClose, onDeleted }: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { data, isError, error, refetch } = useEventQuery(event)
  const stored = data?.event
  const createMutation = useCreateEventMutation()
  const deleteMutation = useDeleteEventMutation()
  const updateMutation = useUpdateEventMutation()
  // A second click lands before the mutation says it is pending, so the
  // dialog keeps its own note of a delete under way.
  const running = useRef(false)
  const pending = deleteMutation.isPending || updateMutation.isPending

  // What Undo puts back, as a move's does. A whole event comes back as a new
  // one, with a new UID, so a CalDAV device sees it as added rather than
  // restored; a deleted occurrence is an edit of its series, undone by
  // writing the series back as it was.
  const deleted = (undo: () => Promise<unknown>) =>
    toast.success(t`Event deleted`, {
      action: {
        label: t`Undo`,
        onClick: () => {
          undo().catch((error: unknown) => {
            toast.error(getErrorMessage(error, t`Failed to undo`))
          })
        },
      },
    })

  const remove = async (scope: Scope) => {
    if (!stored || running.current) return
    running.current = true
    try {
      // The series ending before this occurrence, or nothing at all when
      // this is its first, which makes the deletion one of the whole series.
      const shortened =
        scope === 'following' && stored.recurring
          ? truncatedSeries(stored.components, start, format.timezone)
          : null
      if (
        scope === 'all' ||
        !stored.recurring ||
        (scope === 'following' && !shortened)
      ) {
        await deleteMutation.mutateAsync({
          event: stored.id,
          etag: stored.etag,
        })
        deleted(() =>
          createMutation.mutateAsync({
            calendar: stored.calendar,
            components: stored.components,
          })
        )
      } else {
        const components =
          shortened ??
          deletedOccurrence(stored.components, start, format.timezone)
        if (!components) return
        const { event: changed } = await updateMutation.mutateAsync({
          event: stored.id,
          etag: stored.etag,
          components,
        })
        deleted(() =>
          updateMutation.mutateAsync({
            event: changed.id,
            etag: changed.etag,
            components: stored.components,
          })
        )
      }
      onClose()
      onDeleted?.()
    } catch (failure) {
      if ((failure as { status?: number })?.status === 412) {
        toast.error(t`This event changed somewhere else.`, {
          action: { label: t`Reload`, onClick: () => void refetch() },
        })
        return
      }
      toast.error(getErrorMessage(failure, t`Failed to delete the event`))
    } finally {
      running.current = false
    }
  }

  return (
    <ScopeDialog
      open={event !== null}
      title={t`Delete this event`}
      recurring={Boolean(stored?.recurring)}
      destructive
      icon={<Trash2 className='size-4' />}
      disabled={!stored}
      pending={pending}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onChoose={(scope) => void remove(scope)}
    >
      {isError && !stored && (
        <GeneralError
          mode='inline'
          error={error}
          reset={() => void refetch()}
        />
      )}
    </ScopeDialog>
  )
}
