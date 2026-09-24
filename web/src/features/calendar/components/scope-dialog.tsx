// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { Trans } from '@lingui/react/macro'
import {
  Button,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@mochi/web'
import type { Scope } from '@/lib/ical'

interface Props {
  open: boolean
  title: string
  /** True when the event repeats, so one occurrence can be told from the set. */
  recurring?: boolean
  /**
   * Offers "This and following" beside the two; off for an action that has
   * no series to cut, such as a copy.
   */
  following?: boolean
  destructive?: boolean
  icon?: React.ReactNode
  onOpenChange: (open: boolean) => void
  onChoose: (scope: Scope) => void
}

/**
 * Asks whether an action lands on one occurrence, on it and every one after
 * it, or on the whole series. A one-off event has nothing to choose between,
 * so it gets a plain confirm.
 */
export function ScopeDialog({
  open,
  title,
  recurring = true,
  following = true,
  destructive,
  icon,
  onOpenChange,
  onChoose,
}: Props) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className='sm:max-w-[520px]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter className='gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          {recurring ? (
            <>
              <Button variant='outline' onClick={() => onChoose('one')}>
                {icon}
                <Trans>This event</Trans>
              </Button>
              {following && (
                <Button variant='outline' onClick={() => onChoose('following')}>
                  {icon}
                  <Trans>This and following</Trans>
                </Button>
              )}
              <Button
                variant={destructive ? 'destructive' : 'default'}
                onClick={() => onChoose('all')}
                icon={icon}
              >
                <Trans>All events</Trans>
              </Button>
            </>
          ) : (
            <Button
              variant={destructive ? 'destructive' : 'default'}
              onClick={() => onChoose('all')}
              icon={icon}
            >
              {destructive ? <Trans>Delete</Trans> : <Trans>Save</Trans>}
            </Button>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
