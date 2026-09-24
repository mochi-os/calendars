// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Label,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  Skeleton,
  getAppPath,
  getErrorMessage,
  shellClipboardWrite,
  toast,
  toastAction,
  useFormat,
} from '@mochi/web'
import {
  ArrowLeft,
  Check,
  Copy,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react'
import {
  useCreateTokenMutation,
  useDeleteTokenMutation,
  useTokensQuery,
} from '@/hooks/use-tokens'

type ConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type View = 'name' | 'credentials' | 'manage'

export function ConnectDialog({ onOpenChange, open }: ConnectDialogProps) {
  const { t } = useLingui()
  const { formatTimestamp } = useFormat()
  const [view, setView] = useState<View>('name')
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const { data, isLoading } = useTokensQuery(open && view === 'manage')
  const createMutation = useCreateTokenMutation()
  const deleteMutation = useDeleteTokenMutation()

  // The plaintext token lives only in this dialog's state: closing it is the
  // one and only way it is discarded.
  useEffect(() => {
    if (!open) {
      setView('name')
      setName('')
      setToken(null)
      setDeleting(null)
    }
  }, [open])

  const server = `${window.location.origin}/`
  const address = `${window.location.origin}${getAppPath()}/caldav/`

  const copy = async (text: string) => {
    if (await shellClipboardWrite(text)) {
      toast.success(t`Copied to clipboard`)
    }
  }

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const result = await toastAction(createMutation.mutateAsync(trimmed), {
        loading: t`Connecting device...`,
        success: false,
        error: (error) => getErrorMessage(error, t`Failed to connect device`),
      })
      setToken(result.token)
      setUsername(result.username)
      setName('')
      setView('credentials')
    } catch {
      // toastAction already showed error
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await toastAction(deleteMutation.mutateAsync(deleting), {
        loading: t`Deleting device...`,
        success: t`Device deleted`,
        error: (error) => getErrorMessage(error, t`Failed to delete device`),
      })
      setDeleting(null)
    } catch {
      // toastAction already showed error
    }
  }

  // token/list answers the user's device credentials from both apps, since
  // one password serves contacts and calendars. The dav scope is what makes
  // a token a device: the calendar address links are tokens too, and deleting
  // one from here would quietly break whatever is subscribed to it.
  const tokens = (data?.tokens ?? []).filter((item) =>
    item.scopes.includes('dav')
  )

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        shouldCloseOnInteractOutside={false}
      >
        <ResponsiveDialogContent className='sm:max-w-[520px]'>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              <Trans>Connect device</Trans>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          {view === 'name' && (
            <div className='space-y-2 px-4 pb-4 sm:px-0 sm:pb-0'>
              <Label htmlFor='device-name'>
                <Trans>Device name</Trans>
              </Label>
              <Input
                id='device-name'
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                }}
              />
            </div>
          )}

          {view === 'credentials' && token && (
            <div className='space-y-4 px-4 pb-4 sm:px-0 sm:pb-0'>
              <CredentialRow label={t`Server`} value={server} copy={copy} />
              <CredentialRow
                label={t`Calendar address`}
                value={address}
                copy={copy}
              />
              <CredentialRow
                label={t`Username`}
                value={username}
                copy={copy}
              />
              <CredentialRow label={t`Password`} value={token} copy={copy} />
              <p className='text-sm'>
                <Trans>Save this password now. It cannot be shown again.</Trans>
              </p>
            </div>
          )}

          {view === 'manage' && (
            <div className='px-4 pb-4 sm:px-0 sm:pb-0'>
              {isLoading ? (
                <div className='space-y-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </div>
              ) : tokens.length === 0 ? (
                <p className='text-muted-foreground py-4 text-center text-sm'>
                  <Trans>No devices connected.</Trans>
                </p>
              ) : (
                <div className='max-h-64 space-y-2 overflow-y-auto'>
                  {tokens.map((item) => (
                    <div
                      key={item.hash}
                      className='flex items-center justify-between gap-2 rounded-md border p-3'
                    >
                      <div className='min-w-0 flex-1'>
                        <p className='truncate font-medium'>{item.name}</p>
                        <p className='text-muted-foreground text-xs'>
                          <Trans>
                            Created {formatTimestamp(item.created, t`Never`)}
                          </Trans>
                          {' · '}
                          <Trans>
                            Last used {formatTimestamp(item.used, t`Never`)}
                          </Trans>
                        </p>
                      </div>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => setDeleting(item.hash)}
                        disabled={deleteMutation.isPending}
                        loading={
                          deleteMutation.isPending &&
                          deleteMutation.variables === item.hash
                        }
                        icon={<Trash2 className='size-4' />}
                        aria-label={t`Delete device`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <ResponsiveDialogFooter className='gap-2'>
            {view === 'name' && (
              <>
                <Button variant='outline' onClick={() => setView('manage')}>
                  <Smartphone className='size-4' />
                  <Trans>Manage devices</Trans>
                </Button>
                <Button
                  onClick={() => void create()}
                  loading={createMutation.isPending}
                  disabled={name.trim() === ''}
                  icon={<Plus className='size-4' />}
                >
                  <Trans>Create</Trans>
                </Button>
              </>
            )}
            {view === 'credentials' && (
              <Button variant='outline' onClick={() => onOpenChange(false)}>
                <Check className='size-4' />
                <Trans>Done</Trans>
              </Button>
            )}
            {view === 'manage' && (
              <>
                <Button variant='outline' onClick={() => setView('name')}>
                  <ArrowLeft className='size-4 rtl:rotate-180' />
                  <Trans>Back</Trans>
                </Button>
                <Button
                  onClick={() => setView('name')}
                  icon={<Plus className='size-4' />}
                >
                  <Trans>Connect another device</Trans>
                </Button>
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete device?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>The device will no longer be able to sync calendars.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              loading={deleteMutation.isPending}
            >
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CredentialRow({
  label,
  value,
  copy,
}: {
  label: string
  value: string
  copy: (text: string) => void
}) {
  const { t } = useLingui()
  return (
    <div className='space-y-1'>
      <p className='text-muted-foreground text-xs font-medium'>{label}</p>
      <div className='bg-muted flex items-center gap-2 rounded-md p-2 font-mono text-sm'>
        <code className='flex-1 overflow-x-auto whitespace-nowrap select-all'>
          {value}
        </code>
        <Button
          variant='ghost'
          size='icon'
          className='shrink-0'
          onClick={() => copy(value)}
          icon={<Copy className='size-4' />}
          aria-label={t`Copy ${label}`}
        />
      </div>
    </div>
  )
}
