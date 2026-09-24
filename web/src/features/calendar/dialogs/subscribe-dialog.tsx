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
  ListSkeleton,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  cn,
  getErrorMessage,
  getProviderLabel,
  isInShell,
  isPermissionError,
  naturalCompare,
  shellNavigateTop,
  shellRequestPermission,
  toast,
} from '@mochi/web'
import {
  CalendarSync,
  Check,
  ChevronLeft,
  Link,
  Rss,
  Server,
  Settings,
} from 'lucide-react'
import type { CalendarAccount, RemoteCalendar } from '@/api/types/calendars'
import {
  useAddCalendarAccountMutation,
  useCalendarAccountsQuery,
  useGrantCalendarMutation,
  useLinkCalendarMutation,
  useRemoteCalendarsQuery,
  useSubscribeCalendarMutation,
} from '@/hooks/use-calendars'

/** What the wizard adds: three two-way kinds through an account, and a published address. */
export type SubscribeKind = 'google' | 'apple' | 'caldav' | 'address'

// The colour a linked calendar takes when the other server names none, and
// the one a subscription starts on.
const FALLBACK = '#60a5fa'
const SUBSCRIPTION = '#2dd4bf'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The Google account to start on, as the return from a grant names it. */
  account?: string | null
}

/**
 * Adds a calendar from elsewhere in three stages: the kind, the credential
 * the kind needs, and the calendar the server offers. A published address is
 * read-only and finishes at the second stage; the other three kinds link a
 * calendar both ways through a connected account, made here for Apple and
 * CalDAV and granted through Google's consent for Google.
 */
export function SubscribeDialog({ open, onOpenChange, account }: Props) {
  const { t } = useLingui()
  const [kind, setKind] = useState<SubscribeKind | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  // The credential form for Apple and CalDAV.
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [label, setLabel] = useState('')
  // The published address form.
  const [address, setAddress] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  // The calendar stage.
  const [collection, setCollection] = useState('')
  const [name, setName] = useState('')
  const [colour, setColour] = useState(FALLBACK)

  // Read as soon as the wizard opens: the kinds on offer depend on what the
  // server can grant and what the user already holds.
  const accountsQuery = useCalendarAccountsQuery(open)
  const remoteQuery = useRemoteCalendarsQuery(open ? chosen : null)
  const grantMutation = useGrantCalendarMutation()
  const accountMutation = useAddCalendarAccountMutation()
  const linkMutation = useLinkCalendarMutation()
  const subscribeMutation = useSubscribeCalendarMutation()

  useEffect(() => {
    if (open) {
      setKind(account ? 'google' : null)
      setChosen(account ?? null)
      setServer('')
      setUsername('')
      setPassword('')
      setLabel('')
      setAddress('')
      setAsking(null)
      setCollection('')
      setName('')
      setColour(FALLBACK)
    }
  }, [open, account])

  const accountsError = accountsQuery.error
  useEffect(() => {
    if (accountsError) {
      toast.error(getErrorMessage(accountsError, t`Failed to read the accounts`))
    }
  }, [accountsError, t])

  const remoteError = remoteQuery.error
  useEffect(() => {
    if (remoteError) {
      toast.error(getErrorMessage(remoteError, t`Failed to read the calendars`))
    }
  }, [remoteError, t])

  // The provider's consent runs at the top window and returns the browser to
  // this page with the account it granted.
  const grant = async (fields: { account?: string; provider?: string }) => {
    try {
      const { url } = await grantMutation.mutateAsync({
        ...fields,
        target: window.location.pathname,
      })
      shellNavigateTop(url)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to ask for calendar access`))
    }
  }

  const pick = (row: CalendarAccount) => {
    setChosen(row.id)
    setCollection('')
  }

  // Apple and CalDAV: the account is made and tried here, then opened.
  const connect = async () => {
    if (kind !== 'apple' && kind !== 'caldav') return
    try {
      const { account: made } = await accountMutation.mutateAsync({
        type: kind,
        url: kind === 'caldav' ? server.trim() : undefined,
        username: username.trim(),
        password,
        label: label.trim(),
      })
      pick(made)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to connect the account`))
    }
  }

  const choose = (remote: RemoteCalendar) => {
    setCollection(remote.href)
    setName(remote.name)
    setColour(remote.colour || FALLBACK)
  }

  const link = async () => {
    if (!chosen || collection === '') return
    try {
      await linkMutation.mutateAsync({
        account: chosen,
        collection,
        name: name.trim(),
        colour,
      })
      toast.success(t`Calendar linked`)
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to link the calendar`))
    }
  }

  // The server asks for `url:<host>` before it fetches anything, so the first
  // attempt on a new host comes back as a permission error the shell can
  // answer; granting it makes the same attempt succeed.
  const subscribe = async (target: string): Promise<boolean> => {
    try {
      await subscribeMutation.mutateAsync({
        url: target,
        name: name.trim(),
        colour,
      })
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
        if (answer === 'granted') return subscribe(target)
        return false
      }
      toast.error(getErrorMessage(error, t`Failed to subscribe`))
      return false
    }
  }

  const submitAddress = async () => {
    const trimmed = address.trim()
    if (!trimmed) return
    const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    await subscribe(target)
  }

  const back = () => {
    if (chosen !== null) {
      setChosen(null)
      setCollection('')
    } else {
      setKind(null)
    }
  }

  const accounts = [...(accountsQuery.data?.accounts ?? [])]
    .filter((row) => row.type === kind)
    .sort((a, b) =>
      naturalCompare(a.label || a.identifier, b.label || b.identifier)
    )
  const providers = accountsQuery.data?.providers ?? []
  const administrator = accountsQuery.data?.administrator === true
  // Google is offered when the server can grant an account, when the user
  // already holds one, or to an administrator, who can enable it.
  const google =
    providers.includes('google') ||
    administrator ||
    (accountsQuery.data?.accounts ?? []).some((row) => row.type === 'google')
  const remotes = [...(remoteQuery.data?.calendars ?? [])].sort((a, b) =>
    naturalCompare(a.name, b.name)
  )
  const credentialReady =
    username.trim() !== '' &&
    password !== '' &&
    (kind !== 'caldav' || server.trim() !== '')

  // The kinds read in the order of their names in the user's language.
  const offered: { kind: SubscribeKind; title: string; icon: React.ReactNode }[] =
    [
      {
        kind: 'google',
        title: t`Google Calendar`,
        icon: <CalendarSync className='size-5' />,
      },
      {
        kind: 'apple',
        title: t`Apple iCloud`,
        icon: <CalendarSync className='size-5' />,
      },
      {
        kind: 'caldav',
        title: t`Another Mochi or CalDAV server`,
        icon: <Server className='size-5' />,
      },
      {
        kind: 'address',
        title: t`Published calendar address (read-only)`,
        icon: <Rss className='size-5' />,
      },
    ]
  const kinds = offered
    .filter((row) => row.kind !== 'google' || google)
    .sort((a, b) => naturalCompare(a.title, b.title))

  const accountRow = (row: CalendarAccount) => {
    const allowed = row.granted.includes('calendar')
    return (
      <div key={row.id} className='flex items-center gap-3 rounded-lg border p-3'>
        <button
          type='button'
          disabled={!allowed}
          onClick={() => pick(row)}
          className={cn(
            'flex-1 text-start',
            allowed ? 'hover:text-primary cursor-pointer' : 'cursor-default'
          )}
        >
          <span className='block'>{row.label || row.identifier}</span>
          <span className='text-muted-foreground block text-sm'>
            {getProviderLabel(row.type)}
          </span>
        </button>
        {!allowed && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => void grant({ account: row.id })}
          >
            <Trans>Allow calendar access</Trans>
          </Button>
        )}
      </div>
    )
  }

  const stage = (() => {
    if (kind === null) {
      if (accountsQuery.isLoading) {
        return <ListSkeleton variant='simple' height='h-12' count={4} />
      }
      return (
        <div className='space-y-2'>
          {kinds.map((row) => (
            <button
              key={row.kind}
              type='button'
              onClick={() => {
                setKind(row.kind)
                setName('')
                setColour(row.kind === 'address' ? SUBSCRIPTION : FALLBACK)
              }}
              className='hover:bg-hover flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-start'
            >
              {row.icon}
              <span>{row.title}</span>
            </button>
          ))}
        </div>
      )
    }
    if (kind === 'address') {
      return (
        <>
          <div className='space-y-2'>
            <Label htmlFor='subscribe-url'>
              <Trans>Address</Trans>
            </Label>
            <Input
              id='subscribe-url'
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitAddress()
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
        </>
      )
    }
    if (chosen !== null) {
      return (
        <>
          {remoteQuery.isLoading ? (
            <ListSkeleton variant='simple' height='h-12' count={3} />
          ) : (
            <div className='space-y-2'>
              {remotes.map((remote) => (
                <button
                  key={remote.href}
                  type='button'
                  disabled={remote.linked !== ''}
                  onClick={() => choose(remote)}
                  className={cn(
                    'block w-full rounded-lg border p-3 text-start',
                    remote.linked !== ''
                      ? 'opacity-60'
                      : collection === remote.href
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-hover cursor-pointer'
                  )}
                >
                  <span className='flex items-center gap-2'>
                    {remote.colour !== '' && (
                      <span
                        className='size-3 shrink-0 rounded-full'
                        style={{ backgroundColor: remote.colour }}
                      />
                    )}
                    <span>{remote.name}</span>
                    {remote.linked !== '' && (
                      <span className='bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs'>
                        <Trans>Linked</Trans>
                      </span>
                    )}
                  </span>
                  {remote.description !== '' && (
                    <span className='text-muted-foreground mt-1 block text-sm'>
                      {remote.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {collection !== '' && (
            <>
              <div className='space-y-2'>
                <Label htmlFor='link-name'>
                  <Trans>Name</Trans>
                </Label>
                <Input
                  id='link-name'
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void link()
                  }}
                />
              </div>
              <div className='space-y-2'>
                <Label>
                  <Trans>Colour</Trans>
                </Label>
                <ColourPicker value={colour} onChange={setColour} />
              </div>
            </>
          )}
        </>
      )
    }
    if (accountsQuery.isLoading) {
      return <ListSkeleton variant='simple' height='h-12' count={2} />
    }
    if (kind === 'google') {
      const offered = providers.includes('google')
      return (
        <>
          {accounts.length > 0 && (
            <div className='space-y-2'>{accounts.map(accountRow)}</div>
          )}
          {offered ? (
            // The server can grant one; the user has yet to connect theirs.
            <div className='space-y-3'>
              {accounts.length === 0 && (
                <p className='text-muted-foreground text-sm'>
                  <Trans>You haven't connected a Google account.</Trans>
                </p>
              )}
              <Button variant='outline' onClick={() => void grant({ provider: 'google' })}>
                <Trans>Connect Google</Trans>
              </Button>
            </div>
          ) : (
            accounts.length === 0 &&
            administrator && (
              // The operator has entered no Google client, so nothing can be
              // granted for any user. Only an administrator reaches this
              // step, and is taken to where the client is entered.
              <div className='space-y-3'>
                <p className='text-muted-foreground text-sm'>
                  <Trans>Google accounts have not been enabled on this server.</Trans>
                </p>
                <Button
                  variant='outline'
                  onClick={() => shellNavigateTop('/settings/system/settings')}
                >
                  <Settings className='size-4' />
                  <Trans>Enable Google accounts</Trans>
                </Button>
              </div>
            )
          )}
        </>
      )
    }
    return (
      <>
        {accounts.length > 0 && (
          <div className='space-y-2'>{accounts.map(accountRow)}</div>
        )}
        {kind === 'caldav' && (
          <div className='space-y-2'>
            <Label htmlFor='subscribe-server'>
              <Trans>Server address</Trans>
            </Label>
            <Input
              id='subscribe-server'
              type='url'
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder='https://example.com/calendars/caldav/'
            />
          </div>
        )}
        <div className='space-y-2'>
          <Label htmlFor='subscribe-username'>
            {kind === 'apple' ? <Trans>Apple ID</Trans> : <Trans>Username</Trans>}
          </Label>
          <Input
            id='subscribe-username'
            type={kind === 'apple' ? 'email' : 'text'}
            autoComplete='off'
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='subscribe-password'>
            {kind === 'apple' ? (
              <Trans>App-specific password</Trans>
            ) : (
              <Trans>Password</Trans>
            )}
          </Label>
          <Input
            id='subscribe-password'
            type='password'
            autoComplete='off'
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && credentialReady) void connect()
            }}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='subscribe-label'>
            <Trans>Name</Trans>
          </Label>
          <Input
            id='subscribe-label'
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
      </>
    )
  })()

  const action = (() => {
    if (kind === 'address') {
      return (
        <Button
          onClick={() => void submitAddress()}
          loading={subscribeMutation.isPending || asking !== null}
          disabled={address.trim() === ''}
          icon={<Rss className='size-4' />}
        >
          <Trans>Subscribe</Trans>
        </Button>
      )
    }
    if (chosen !== null) {
      return (
        <Button
          onClick={() => void link()}
          loading={linkMutation.isPending}
          disabled={collection === ''}
          icon={<Link className='size-4' />}
        >
          <Trans>Link</Trans>
        </Button>
      )
    }
    if (kind === 'apple' || kind === 'caldav') {
      return (
        <Button
          onClick={() => void connect()}
          loading={accountMutation.isPending}
          disabled={!credentialReady}
          icon={<Check className='size-4' />}
        >
          <Trans>Connect</Trans>
        </Button>
      )
    }
    return null
  })()

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
        <div className='max-h-[60vh] space-y-4 overflow-y-auto px-4 pb-4 sm:px-0 sm:pb-0'>
          {kind !== null && (
            <Button variant='ghost' size='sm' className='-ms-2' onClick={back}>
              <ChevronLeft className='size-4' />
              <Trans>Back</Trans>
            </Button>
          )}
          {stage}
        </div>
        <ResponsiveDialogFooter className='gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          {action}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
