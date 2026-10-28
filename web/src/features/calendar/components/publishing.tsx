// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
//
// Where an own calendar publishes its events: the owner's accounts on other
// networks, each switched on or off for the calendar, and for one new event
// in the editor. Removing an account offers to delete the copies already
// there, keeping them by default.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  ConfirmDialog,
  GeneralError,
  Label,
  Switch,
  getErrorMessage,
  naturalCompare,
  providerName,
  toast,
} from '@mochi/web'
import { Archive } from 'lucide-react'
import { calendarsApi } from '@/api/calendars'
import type { PublishAccount } from '@/api/types/calendars'

// Whether a calendar's Publish to tab is offered: one of the user's own
// calendars with an account to publish to, or whose answer failed and shows
// why. Undefined while it is asked.
export function usePublishOffered(
  calendar: string,
  enabled: boolean
): boolean | undefined {
  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', 'publish', calendar],
    queryFn: () => calendarsApi.publish(calendar),
    retry: false,
    enabled,
  })
  if (!enabled) return false
  if (isLoading) return undefined
  return !!error || (data?.accounts ?? []).length > 0
}

export function PublishingSection({ calendar }: { calendar: string }) {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calendar', 'publish', calendar],
    queryFn: () => calendarsApi.publish(calendar),
    retry: false,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [kept, setKept] = useState<{
    account: PublishAccount
    count: number
  } | null>(null)

  const accounts = [...(data?.accounts ?? [])].sort((a, b) =>
    naturalCompare(a.identifier, b.identifier)
  )
  const publish = data?.publish ?? []

  // With no account to publish to, as for every user while the networks are
  // off, there is nothing to choose, so nothing shows while it is asked.
  if (isLoading || (!error && accounts.length === 0)) return null

  const toggle = async (account: PublishAccount, on: boolean) => {
    setBusy(account.id)
    const next = on
      ? [...publish, account.id]
      : publish.filter((id) => id !== account.id)
    try {
      const answer = await calendarsApi.setPublish(calendar, next)
      await queryClient.invalidateQueries({
        queryKey: ['calendar', 'publish', calendar],
      })
      if (!on && answer.kept[account.id]) {
        setKept({ account, count: answer.kept[account.id] })
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t`Could not save the accounts`))
    } finally {
      setBusy(null)
    }
  }

  const forget = async (account: PublishAccount) => {
    try {
      const answer = await calendarsApi.forgetCopies(calendar, account.id)
      toast.success(t`Deleted ${answer.deleted} copies`)
      await refetch()
    } catch (err) {
      toast.error(getErrorMessage(err, t`Could not delete the copies`))
    }
  }

  return (
    <div className='space-y-2'>
      <Label>
        <Trans>Publish to</Trans>
      </Label>
      {error ? (
        <GeneralError error={error} minimal mode='inline' reset={refetch} />
      ) : (
        <div>
          {accounts.map((account) => (
            <div
              key={account.id}
              className='flex items-center justify-between gap-4 py-2'
            >
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>
                  {account.identifier}
                </div>
                <div className='text-muted-foreground text-xs'>
                  {providerName(account.type)}
                  {data?.copies[account.id]
                    ? ' · ' +
                      plural(data.copies[account.id], {
                        one: '# copy',
                        other: '# copies',
                      })
                    : ''}
                </div>
              </div>
              <Switch
                checked={publish.includes(account.id)}
                loading={busy === account.id}
                aria-label={t`Publish to ${account.identifier}`}
                onCheckedChange={(on) => void toggle(account, on)}
              />
            </div>
          ))}
        </div>
      )}
      {kept && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setKept(null)
          }}
          title={t`Delete the copies on ${kept.account.identifier}?`}
          desc={t`Copies published there: ${kept.count}. They stay unless you delete them.`}
          confirmText={t`Delete copies`}
          cancelBtnText={t`Keep`}
          icon={<Archive className='size-4' />}
          destructive
          handleConfirm={async () => {
            const account = kept.account
            setKept(null)
            await forget(account)
          }}
        />
      )}
    </div>
  )
}

/**
 * The accounts one new event goes to, preset from its calendar's list. Shown
 * only where the calendar may publish and the user has an account to choose.
 */
export function PublishSwitches({
  calendar,
  chosen,
  onChange,
}: {
  calendar: string
  /** The accounts chosen for this event, or null to follow the calendar's list. */
  chosen: string[] | null
  onChange: (accounts: string[]) => void
}) {
  const { data } = useQuery({
    queryKey: ['calendar', 'publish', calendar],
    queryFn: () => calendarsApi.publish(calendar),
    enabled: calendar !== '',
    retry: false,
  })
  const accounts = [...(data?.accounts ?? [])].sort((a, b) =>
    naturalCompare(a.identifier, b.identifier)
  )
  if (accounts.length === 0) return null
  const selected = chosen ?? data?.publish ?? []
  return (
    <div className='space-y-2'>
      <Label>
        <Trans>Publish to</Trans>
      </Label>
      <div className='flex flex-wrap gap-3'>
        {accounts.map((account) => (
          <label key={account.id} className='flex items-center gap-2 text-sm'>
            <Switch
              checked={selected.includes(account.id)}
              aria-label={account.identifier}
              onCheckedChange={(on) =>
                onChange(
                  on
                    ? [...selected, account.id]
                    : selected.filter((id) => id !== account.id)
                )
              }
            />
            {account.identifier}
          </label>
        ))}
      </div>
    </div>
  )
}
