// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ColourPicker,
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
import { useColourCalendarMutation } from '@/hooks/use-calendars'

interface Props {
  calendar: Calendar | null
  onClose: () => void
}

export function ColourDialog({ calendar, onClose }: Props) {
  const { t } = useLingui()
  const [colour, setColour] = useState('#60a5fa')
  const colourMutation = useColourCalendarMutation()

  useEffect(() => {
    if (calendar) setColour(calendar.colour)
  }, [calendar])

  const submit = async () => {
    if (!calendar) return
    try {
      await toastAction(
        colourMutation.mutateAsync({ calendar: calendar.id, colour }),
        {
          loading: t`Saving colour...`,
          success: t`Colour saved`,
          error: (error) => getErrorMessage(error, t`Failed to save the colour`),
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
            <Trans>Calendar colour</Trans>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className='px-4 pb-4 sm:px-0 sm:pb-0'>
          <ColourPicker value={colour} onChange={setColour} />
        </div>
        <ResponsiveDialogFooter className='gap-2'>
          <Button variant='outline' onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void submit()}
            loading={colourMutation.isPending}
            disabled={colour === calendar?.colour}
            icon={<Check className='size-4' />}
          >
            <Trans>Save</Trans>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
