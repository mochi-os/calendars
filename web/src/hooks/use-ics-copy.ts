// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import { getErrorMessage, shellClipboardWrite, toast } from '@mochi/web'
import { calendarsApi } from '@/api/calendars'

/**
 * Copies a calendar's ICS address. Only the token's hash is stored, so the
 * address can be shown once; replacing it is the user's call, since it breaks
 * anything already subscribed to it.
 */
export function useIcsCopy() {
  const { t } = useLingui()

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
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to get the calendar address`))
    }
  }

  const revoke = async (calendar: string) => {
    try {
      await calendarsApi.addressRevoke(calendar)
      toast.success(t`Calendar address revoked`)
    } catch (error) {
      toast.error(
        getErrorMessage(error, t`Failed to revoke the calendar address`)
      )
    }
  }

  return { copy, revoke }
}
