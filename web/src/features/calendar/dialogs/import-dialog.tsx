// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useState } from 'react'
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  Input,
  Label,
  Progress,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  getErrorMessage,
  toast,
  useFormat,
} from '@mochi/web'
import { Upload } from 'lucide-react'
import type { Calendar } from '@/api/types/calendars'
import { type ImportTotals, useImportEventsMutation } from '@/hooks/use-events'

interface Props {
  calendar: Calendar | null
  onClose: () => void
}

/**
 * Imports an iCalendar file into one calendar. Events already in it are
 * skipped, so a file can be imported again safely; the dialog stays open
 * until the last round has answered.
 */
export function ImportDialog({ calendar, onClose }: Props) {
  const { t } = useLingui()
  const { formatNumber } = useFormat()
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [result, setResult] = useState<ImportTotals | null>(null)
  const importMutation = useImportEventsMutation()
  const running = importMutation.isPending

  const close = () => {
    if (running) return
    setFile(null)
    setProgress(null)
    setResult(null)
    onClose()
  }

  const submit = async () => {
    if (!calendar || !file || running) return
    setProgress(null)
    try {
      setResult(
        await importMutation.mutateAsync({
          calendar: calendar.id,
          file,
          progress: (done, total) => setProgress({ done, total }),
        })
      )
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to import events`))
    }
  }

  const known = progress !== null && progress.total > 0
  const done = formatNumber(progress?.done ?? 0)
  const total = formatNumber(progress?.total ?? 0)
  const imported = formatNumber(result?.imported ?? 0)
  const skipped = formatNumber(result?.skipped ?? 0)
  const failed = formatNumber(result?.failed ?? 0)

  return (
    <ResponsiveDialog
      open={calendar !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      shouldCloseOnInteractOutside={false}
    >
      <ResponsiveDialogContent className='sm:max-w-[420px]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <Trans>Import events</Trans>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {result ? (
          <ul className='space-y-1 text-sm'>
            <li>
              {t`${plural(result.imported, {
                one: `${imported} event imported`,
                other: `${imported} events imported`,
              })}`}
            </li>
            {result.skipped > 0 && (
              <li>
                {t`${plural(result.skipped, {
                  one: `${skipped} event already in the calendar`,
                  other: `${skipped} events already in the calendar`,
                })}`}
              </li>
            )}
            {result.failed > 0 && (
              <li className='text-destructive'>
                {t`${plural(result.failed, {
                  one: `${failed} event could not be imported`,
                  other: `${failed} events could not be imported`,
                })}`}
              </li>
            )}
          </ul>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='calendar-import'>
                <Trans>iCalendar file</Trans>
              </Label>
              <Input
                id='calendar-import'
                type='file'
                accept='.ics,text/calendar'
                disabled={running}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            {running && (
              <div className='space-y-2'>
                <Progress
                  value={known ? progress.done : null}
                  max={known ? progress.total : 100}
                />
                {known && (
                  <p className='text-muted-foreground text-sm'>
                    {t`${plural(progress.total, {
                      one: `${done} of ${total} event`,
                      other: `${done} of ${total} events`,
                    })}`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <ResponsiveDialogFooter className='gap-2'>
          {result ? (
            <Button variant='outline' onClick={close}>
              <Trans>Close</Trans>
            </Button>
          ) : (
            <>
              <Button variant='outline' onClick={close} disabled={running}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                onClick={() => void submit()}
                loading={running}
                disabled={file === null}
                icon={<Upload className='size-4' />}
              >
                <Trans>Import</Trans>
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
