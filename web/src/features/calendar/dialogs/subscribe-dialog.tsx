// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ColourPicker,
  Input,
  Label,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  getErrorMessage,
  isInShell,
  isPermissionError,
  shellRequestPermission,
  toast,
} from '@mochi/web'
import { Rss } from 'lucide-react'
import { useSubscribeCalendarMutation } from '@/hooks/use-calendars'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SubscribeDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [colour, setColour] = useState('#2dd4bf')
  const [asking, setAsking] = useState<string | null>(null)
  const subscribeMutation = useSubscribeCalendarMutation()

  useEffect(() => {
    if (open) {
      setUrl('')
      setName('')
      setAsking(null)
    }
  }, [open])

  // The server asks for `url:<host>` before it fetches anything, so the first
  // attempt on a new host comes back as a permission error the shell can
  // answer; granting it makes the same attempt succeed.
  const subscribe = async (address: string): Promise<boolean> => {
    try {
      await subscribeMutation.mutateAsync({ url: address, name, colour })
      toast.success(t`Subscribed`)
      onOpenChange(false)
      return true
    } catch (error) {
      const permission = isPermissionError(
        (error as { data?: unknown })?.data ??
          (error as { response?: { data?: unknown } })?.response?.data
      )
      if (permission && !permission.restricted && isInShell()) {
        setAsking(
          permission.permission.startsWith('url:')
            ? permission.permission.slice(4)
            : ''
        )
        const answer = await shellRequestPermission(permission.permission)
        setAsking(null)
        if (answer === 'granted') return subscribe(address)
        return false
      }
      toast.error(getErrorMessage(error, t`Failed to subscribe`))
      return false
    }
  }

  const submit = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const address = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    await subscribe(address)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldCloseOnInteractOutside={false}
    >
      <ResponsiveDialogContent className='sm:max-w-[520px]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className='flex items-center gap-2'>
            <Rss className='size-5' />
            <Trans>Subscribe to calendar</Trans>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className='space-y-4 px-4 pb-4 sm:px-0 sm:pb-0'>
          <div className='space-y-2'>
            <Label htmlFor='subscribe-url'>
              <Trans>Address</Trans>
            </Label>
            <Input
              id='subscribe-url'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='subscribe-name'>
              <Trans>Name</Trans>
            </Label>
            <Input
              id='subscribe-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>
              <Trans>Colour</Trans>
            </Label>
            <ColourPicker value={colour} onChange={setColour} />
          </div>
          {asking !== null && (
            <p className='text-muted-foreground text-sm'>
              <Trans>Requesting access to {asking}...</Trans>
            </p>
          )}
        </div>
        <ResponsiveDialogFooter className='gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void submit()}
            loading={subscribeMutation.isPending || asking !== null}
            disabled={url.trim() === ''}
            icon={<Rss className='size-4' />}
          >
            <Trans>Subscribe</Trans>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
