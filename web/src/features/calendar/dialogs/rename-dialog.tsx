// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  Input,
  Label,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  getErrorMessage,
  toastAction,
} from '@mochi/web'
import { Check } from 'lucide-react'
import type { Calendar } from '@/api/types/calendars'
import { useRenameCalendarMutation } from '@/hooks/use-calendars'

interface Props {
  calendar: Calendar | null
  onClose: () => void
}

export function RenameDialog({ calendar, onClose }: Props) {
  const { t } = useLingui()
  const [name, setName] = useState('')
  const renameMutation = useRenameCalendarMutation()

  // The dialog is opened by the parent setting `calendar`, so there is no open
  // event to seed the field from.
  useEffect(() => {
    if (calendar) setName(calendar.name)
  }, [calendar])

  const submit = async () => {
    if (!calendar) return
    try {
      await toastAction(
        renameMutation.mutateAsync({
          calendar: calendar.id,
          name: name.trim(),
        }),
        {
          loading: t`Renaming calendar...`,
          success: t`Calendar renamed`,
          error: (error) =>
            getErrorMessage(error, t`Failed to rename calendar`),
        }
      )
      onClose()
    } catch {
      // toastAction already showed error
    }
  }

  return (
    <ResponsiveDialog
      open={calendar !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      shouldCloseOnInteractOutside={false}
    >
      <ResponsiveDialogContent className='sm:max-w-[420px]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <Trans>Rename calendar</Trans>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className='space-y-2 px-4 pb-4 sm:px-0 sm:pb-0'>
          <Label htmlFor='calendar-name'>
            <Trans>Name</Trans>
          </Label>
          <Input
            id='calendar-name'
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
        </div>
        <ResponsiveDialogFooter className='gap-2'>
          <Button variant='outline' onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void submit()}
            loading={renameMutation.isPending}
            disabled={name.trim() === ''}
            icon={<Check className='size-4' />}
          >
            <Trans>Save</Trans>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
