// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ConfirmDialog,
  DataChip,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@mochi/web'
import { Check } from 'lucide-react'
import type { AddressDialogState } from '@/hooks/use-ics-copy'

/** The dialogs `useIcsCopy` drives: the new address, and the two confirms. */
export function AddressDialogs({ state }: { state: AddressDialogState }) {
  const { t } = useLingui()
  // Both break the address others already hold, so they say the same thing.
  const loss = t`Anyone subscribed to the current address stops getting updates.`

  return (
    <>
      <ResponsiveDialog
        open={state.issued !== null}
        onOpenChange={(open) => {
          if (!open) state.closeIssued()
        }}
        // The address cannot be shown again, so only a deliberate close loses it.
        shouldCloseOnInteractOutside={false}
      >
        <ResponsiveDialogContent className='sm:max-w-[560px]'>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              <Trans>Calendar address</Trans>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className='space-y-4'>
            <DataChip
              value={state.issued ?? ''}
              truncate='none'
              copyButtonMode='always'
              className='w-full'
              chipClassName='flex-1'
            />
            <p className='text-sm'>
              <Trans>Save this address now. It cannot be shown again.</Trans>
            </p>
          </div>
          <ResponsiveDialogFooter>
            <Button variant='outline' onClick={state.closeIssued}>
              <Check className='size-4' />
              <Trans>Done</Trans>
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={state.replacing}
        onOpenChange={(open) => {
          if (!open) state.cancelReplace()
        }}
        title={t`Replace calendar address?`}
        desc={loss}
        confirmText={t`Replace`}
        destructive
        isLoading={state.busy}
        handleConfirm={() => void state.replace()}
      />

      <ConfirmDialog
        open={state.revoking}
        onOpenChange={(open) => {
          if (!open) state.cancelRevoke()
        }}
        title={t`Revoke calendar address?`}
        desc={loss}
        confirmText={t`Revoke`}
        destructive
        isLoading={state.busy}
        handleConfirm={() => void state.confirmRevoke()}
      />
    </>
  )
}
