// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { getErrorMessage, toast } from '@mochi/web'
import { calendarsApi } from '@/api/calendars'

/**
 * Issues, replaces and revokes a calendar's ICS address. Only the token's hash
 * is stored, so a new address is shown once, in a dialog rather than only on
 * the clipboard: a copy made after the request has lost the click that allows
 * it, and a failed copy would leave nothing but Replace. Replacing and revoking
 * both break anything already subscribed, so each waits for a confirm.
 * `AddressDialogs` renders the dialogs this state drives.
 */
export function useIcsCopy() {
  const { t } = useLingui()
  // The address just issued, on show until the user closes it.
  const [issued, setIssued] = useState<string | null>(null)
  // The calendar whose address is waiting on a confirm to replace or revoke.
  const [replacing, setReplacing] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const issue = async (calendar: string, regenerate: boolean) => {
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
              onClick: () => setReplacing(calendar),
            },
          }
        )
        return
      }
      setIssued(`${window.location.origin}${path}?token=${token}`)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to get the calendar address`))
    }
  }

  const copy = (calendar: string) => issue(calendar, false)

  const replace = async () => {
    if (!replacing) return
    setBusy(true)
    await issue(replacing, true)
    setBusy(false)
    setReplacing(null)
  }

  const revoke = async () => {
    if (!revoking) return
    setBusy(true)
    try {
      await calendarsApi.addressRevoke(revoking)
      toast.success(t`Calendar address revoked`)
      setRevoking(null)
    } catch (error) {
      toast.error(
        getErrorMessage(error, t`Failed to revoke the calendar address`)
      )
    } finally {
      setBusy(false)
    }
  }

  return {
    copy,
    /** Asks first, then revokes. */
    revoke: (calendar: string) => setRevoking(calendar),
    dialogs: {
      issued,
      closeIssued: () => setIssued(null),
      replacing: replacing !== null,
      cancelReplace: () => setReplacing(null),
      replace,
      revoking: revoking !== null,
      cancelRevoke: () => setRevoking(null),
      confirmRevoke: revoke,
      busy,
    },
  }
}

export type AddressDialogState = ReturnType<typeof useIcsCopy>['dialogs']
