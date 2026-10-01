// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  ConfirmDialog,
  DataChip,
  FieldRow,
  GeneralError,
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
  toastAction,
  useFormat,
} from '@mochi/web'
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react'
import {
  useCreateTokenMutation,
  useDeleteTokenMutation,
  useTokensQuery,
} from '@/hooks/use-tokens'

type ConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type View = 'list' | 'name' | 'credentials'

export function ConnectDialog({ onOpenChange, open }: ConnectDialogProps) {
  const { t } = useLingui()
  const { formatTimestamp } = useFormat()
  const [view, setView] = useState<View>('list')
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  // Fetched whenever the dialog is open: the list carries the account's
  // username, which the connection details show before any device exists.
  const { data, error, isLoading, refetch } = useTokensQuery(open)
  const createMutation = useCreateTokenMutation()
  const deleteMutation = useDeleteTokenMutation()

  // The plaintext token lives in this dialog's state and in the create
  // request's result; Done and closing discard both. The dialog stays mounted,
  // so neither goes on its own.
  const resetCreate = createMutation.reset
  useEffect(() => {
    if (!open) {
      setView('list')
      setName('')
      setToken(null)
      setDeleting(null)
      resetCreate()
    }
  }, [open, resetCreate])

  const server = `${window.location.origin}/`
  const address = `${window.location.origin}${getAppPath()}/caldav/`

  const create = async () => {
    const trimmed = name.trim()
    // Enter reaches here as well as the button, which is disabled meanwhile:
    // each call mints another credential.
    if (!trimmed || createMutation.isPending) return
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

  // A new device's own answer covers a list that has not come back.
  const account = data?.username || username

  // Only the password is secret: the server, the address and the username
  // are the same for every device, so they stay on show.
  const details = (
    <>
      <Detail label={t`Server`} value={server} />
      <Detail label={t`Calendar address`} value={address} />
      {account && <Detail label={t`Username`} value={account} />}
    </>
  )

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
        <ResponsiveDialogContent className='sm:max-w-[720px]'>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              <Trans>Connected devices</Trans>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          {view === 'name' && (
            <div className='space-y-2'>
              <Label htmlFor='device-name'>
                <Trans>Device name</Trans>
              </Label>
              <Input
                id='device-name'
                value={name}
                maxLength={100}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void create()
                }}
              />
            </div>
          )}

          {view === 'credentials' && token && (
            <div className='space-y-4'>
              <div>
                {details}
                <Detail label={t`Password`} value={token} />
              </div>
              <p className='text-sm'>
                <Trans>Save this password now. It cannot be shown again.</Trans>
              </p>
            </div>
          )}

          {view === 'list' && (
            <div className='space-y-4'>
              <div>{details}</div>
              {isLoading ? (
                <div className='space-y-2'>
                  <Skeleton className='h-12 w-full' />
                  <Skeleton className='h-12 w-full' />
                </div>
              ) : error ? (
                <GeneralError
                  error={error}
                  minimal
                  mode='inline'
                  reset={() => void refetch()}
                />
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
                            Created{' '}
                            {formatTimestamp(
                              item.created,
                              t({ message: 'Never', context: 'last used' })
                            )}
                          </Trans>
                          {' · '}
                          <Trans>
                            Last used{' '}
                            {formatTimestamp(
                              item.used,
                              t({ message: 'Never', context: 'last used' })
                            )}
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
            {view === 'list' && (
              <>
                {/* Nothing here to cancel: the list only shows. */}
                <Button variant='outline' onClick={() => onOpenChange(false)}>
                  <Trans>Close</Trans>
                </Button>
                <Button
                  onClick={() => setView('name')}
                  icon={<Plus className='size-4' />}
                >
                  <Trans>Add device</Trans>
                </Button>
              </>
            )}
            {view === 'name' && (
              <>
                <Button variant='outline' onClick={() => setView('list')}>
                  <ArrowLeft className='size-4 rtl:rotate-180' />
                  <Trans>Back</Trans>
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
              <Button
                variant='outline'
                onClick={() => {
                  setToken(null)
                  createMutation.reset()
                  setView('list')
                }}
              >
                <Check className='size-4' />
                <Trans>Done</Trans>
              </Button>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleting(null)
        }}
        title={t`Delete device?`}
        desc={t`The device will no longer be able to sync contacts or calendars.`}
        confirmText={
          <>
            <Trash2 className='size-4' />
            <Trans>Delete</Trans>
          </>
        }
        destructive
        isLoading={deleteMutation.isPending}
        handleConfirm={() => void remove()}
      />
    </>
  )
}

/** A label and its value on one row, the value copyable, as settings shows them. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <FieldRow
      label={label}
      className='py-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3'
    >
      <DataChip
        value={value}
        truncate='none'
        copyButtonMode='always'
        className='w-full'
        chipClassName='flex-1'
      />
    </FieldRow>
  )
}
