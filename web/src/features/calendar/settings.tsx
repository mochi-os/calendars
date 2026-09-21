// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ColourPicker,
  DetailSkeleton,
  GeneralError,
  getErrorMessage,
  Input,
  Label,
  Main,
  PageHeader,
  toastAction,
  usePageTitle,
} from '@mochi/web'
import { Check, Copy, Link2 } from 'lucide-react'
import { calendarsApi } from '@/api/calendars'
import type { CalendarResponse } from '@/api/types/calendars'
import {
  useColourCalendarMutation,
  useRenameCalendarMutation,
} from '@/hooks/use-calendars'
import { useIcsCopy } from '@/hooks/use-ics-copy'

/**
 * A calendar's own page at /calendars/<fingerprint>: what it is called, what
 * colour it is drawn in, and the address others can subscribe to.
 */
export function CalendarSettings({ fingerprint }: { fingerprint: string }) {
  const { t } = useLingui()
  const { data, isLoading, isError, refetch } = useQuery<CalendarResponse>({
    queryKey: ['calendar', fingerprint],
    queryFn: () => calendarsApi.get(fingerprint),
  })
  const calendar = data?.calendar
  usePageTitle(calendar?.name ?? t`Calendars`)

  const [name, setName] = useState('')
  const [colour, setColour] = useState('')
  // The server records why a poll failed as a token: too_large, invalid, or
  // status:<n> with 0 for an address that could not be reached. A token this
  // build has no words for is shown as it is rather than hidden.
  const failureReason = (failure: string): string => {
    if (failure === 'too_large') return t`the calendar is too large`
    if (failure === 'invalid') return t`the address does not serve a calendar`
    if (failure.startsWith('status:')) {
      const status = failure.slice('status:'.length)
      if (status === '0') return t`the address could not be reached`
      return t`the address answered ${status}`
    }
    return failure
  }
  const renameMutation = useRenameCalendarMutation()
  const colourMutation = useColourCalendarMutation()
  const { copy, revoke } = useIcsCopy()

  useEffect(() => {
    if (calendar) {
      setName(calendar.name)
      setColour(calendar.colour)
    }
  }, [calendar])

  if (isLoading) return <DetailSkeleton />
  if (isError || !calendar) {
    return <GeneralError minimal reset={() => void refetch()} />
  }

  const saveName = async () => {
    try {
      await toastAction(
        renameMutation.mutateAsync({ calendar: calendar.id, name: name.trim() }),
        {
          loading: t`Renaming calendar...`,
          success: t`Calendar renamed`,
          error: (error) =>
            getErrorMessage(error, t`Failed to rename calendar`),
        }
      )
    } catch {
      // toastAction already showed error
    }
  }

  const saveColour = async () => {
    try {
      await toastAction(
        colourMutation.mutateAsync({ calendar: calendar.id, colour }),
        {
          loading: t`Saving colour...`,
          success: t`Colour saved`,
          error: (error) => getErrorMessage(error, t`Failed to save the colour`),
        }
      )
    } catch {
      // toastAction already showed error
    }
  }

  return (
    <Main>
      <PageHeader title={calendar.name} />
      <div className='max-w-lg space-y-6'>
        {calendar.kind === 'subscription' && calendar.failure !== '' && (
          <p className='text-destructive text-sm'>
            <Trans>The last fetch failed: {failureReason(calendar.failure)}</Trans>
          </p>
        )}
        <div className='space-y-2'>
          <Label htmlFor='settings-name'>
            <Trans>Name</Trans>
          </Label>
          <div className='flex gap-2'>
            <Input
              id='settings-name'
              value={name}
              disabled={calendar.readonly && calendar.kind === 'birthdays'}
              onChange={(input) => setName(input.target.value)}
            />
            <Button
              onClick={() => void saveName()}
              loading={renameMutation.isPending}
              disabled={name.trim() === '' || name === calendar.name}
              icon={<Check className='size-4' />}
            >
              <Trans>Save</Trans>
            </Button>
          </div>
        </div>

        <div className='space-y-2'>
          <Label>
            <Trans>Colour</Trans>
          </Label>
          <ColourPicker
            value={colour}
            onChange={setColour}
            actions={
              <Button
                size='sm'
                onClick={() => void saveColour()}
                loading={colourMutation.isPending}
                disabled={colour === calendar.colour}
                icon={<Check className='size-4' />}
              >
                <Trans>Save</Trans>
              </Button>
            }
          />
        </div>

        <div className='space-y-2'>
          <Label>
            <Trans>Calendar address</Trans>
          </Label>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => void copy(calendar.id)}>
              <Copy className='size-4' />
              <Trans>Copy</Trans>
            </Button>
            <Button variant='outline' onClick={() => void revoke(calendar.id)}>
              <Link2 className='size-4' />
              <Trans>Revoke</Trans>
            </Button>
          </div>
        </div>
      </div>
    </Main>
  )
}
