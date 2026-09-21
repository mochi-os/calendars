// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import { getErrorMessage, toast, useFormat } from '@mochi/web'
import { Trash2 } from 'lucide-react'
import {
  useDeleteEventMutation,
  useEventQuery,
  useUpdateEventMutation,
} from '@/hooks/use-events'
import { deletedOccurrence, type Scope } from '@/lib/ical'
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
export function DeleteEventDialog({
  event,
  start,
  onClose,
  onDeleted,
}: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { data, refetch } = useEventQuery(event)
  const stored = data?.event
  const deleteMutation = useDeleteEventMutation()
  const updateMutation = useUpdateEventMutation()

  const remove = async (scope: Scope) => {
    if (!stored) return
    try {
      if (scope === 'all' || !stored.recurring) {
        await deleteMutation.mutateAsync({
          event: stored.id,
          etag: stored.etag,
        })
      } else {
        const components = deletedOccurrence(
          stored.components,
          start,
          format.timezone
        )
        if (!components) return
        await updateMutation.mutateAsync({
          event: stored.id,
          etag: stored.etag,
          components,
        })
      }
      toast.success(t`Event deleted`)
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
    }
  }

  return (
    <ScopeDialog
      open={event !== null}
      title={t`Delete this event`}
      recurring={Boolean(stored?.recurring)}
      destructive
      icon={<Trash2 className='size-4' />}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onChoose={(scope) => void remove(scope)}
    />
  )
}
