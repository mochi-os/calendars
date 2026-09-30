// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ConfirmDialog,
  Input,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  getErrorMessage,
  shellClipboardWrite,
  toast,
} from '@mochi/web'
import { Link2 } from 'lucide-react'
import { calendarsApi } from '@/api/calendars'

/**
 * Copies a calendar's ICS address. Only the token's hash is stored, so the
 * address can be shown once; replacing it is the user's call, since it breaks
 * anything already subscribed to it. `dialogs` renders the address when the
 * clipboard refuses it, and the question before a revoke.
 */
export function useIcsCopy() {
  const { t } = useLingui()
  // An address the clipboard would not take, shown to copy by hand: once this
  // closes it cannot be shown again.
  const [shown, setShown] = useState<string | null>(null)
  // The calendar whose address the revoke question is about.
  const [revoking, setRevoking] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const copy = async (calendar: string, regenerate = false) => {
    try {
      const { token, path, exists } = await calendarsApi.address(
        calendar,
        regenerate
      )
      if (exists || !token || !path) {
        toast.info(
          t`This calendar address was already issued and cannot be shown again.`,
          {
            action: {
              label: t`Replace`,
              onClick: () => void copy(calendar, true),
            },
          }
        )
        return
      }
      const address = `${window.location.origin}${path}?token=${token}`
      if (await shellClipboardWrite(address)) {
        toast.success(
          regenerate
            ? t`New calendar address copied to clipboard`
            : t`Calendar address copied to clipboard`
        )
      } else {
        setShown(address)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to get the calendar address`))
    }
  }

  const revoke = async () => {
    if (revoking === null || pending) return
    setPending(true)
    try {
      const { revoked } = await calendarsApi.addressRevoke(revoking)
      if (revoked) {
        toast.success(t`Calendar address revoked`)
      } else {
        toast.info(t`This calendar has no address to revoke`)
      }
      setRevoking(null)
    } catch (error) {
      toast.error(
        getErrorMessage(error, t`Failed to revoke the calendar address`)
      )
    } finally {
      setPending(false)
    }
  }

  const dialogs = (
    <>
      <ResponsiveDialog
        open={shown !== null}
        onOpenChange={(open) => {
          if (!open) setShown(null)
        }}
      >
        <ResponsiveDialogContent className='sm:max-w-[520px]'>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              <Trans>Calendar address</Trans>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <Input
            readOnly
            value={shown ?? ''}
            aria-label={t`Calendar address`}
            onFocus={(event) => event.currentTarget.select()}
          />
          <ResponsiveDialogFooter>
            <Button variant='outline' onClick={() => setShown(null)}>
              <Trans>Close</Trans>
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={t`Revoke the calendar address?`}
        desc={t`Calendars subscribed to this address will stop updating.`}
        confirmText={
          <>
            <Link2 className='size-4' />
            <Trans>Revoke</Trans>
          </>
        }
        destructive
        isLoading={pending}
        handleConfirm={() => void revoke()}
      />
    </>
  )

  return { copy, revoke: setRevoking, dialogs }
}
