// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscribeDialog } from './subscribe-dialog'

const link = vi.fn().mockResolvedValue({})
const subscribe = vi.fn().mockResolvedValue({})
const grant = vi
  .fn()
  .mockResolvedValue({ url: '/_/auth/oauth/google/start?state=s1' })
// The account request as the API receives it: the wizard adds accounts
// through the real hook, so the test can see what the client keeps of it.
const { connect } = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue({
    account: {
      id: 'a3',
      type: 'caldav',
      label: 'Home server',
      identifier: 'https://home.test/dav/',
      granted: ['calendar'],
    },
  }),
}))
let providers: string[] = ['google']
let administrator = false
// Whether a link or a subscription is already under way.
let linking = false
let subscribing = false

const everyone = [
  {
    id: 'a1',
    type: 'google',
    label: '',
    identifier: 'someone@example.test',
    granted: ['login'],
  },
  {
    id: 'a2',
    type: 'caldav',
    label: 'Work server',
    identifier: 'worker',
    granted: ['calendar'],
  },
]
let accounts = everyone

vi.mock('@/api/calendars', () => ({
  calendarsApi: { account: connect },
}))

vi.mock('@/hooks/use-calendars', async (importOriginal) => ({
  useAddCalendarAccountMutation: (
    await importOriginal<typeof import('@/hooks/use-calendars')>()
  ).useAddCalendarAccountMutation,
  useCalendarAccountsQuery: () => ({
    data: {
      accounts,
      providers,
      administrator,
    },
    isLoading: false,
    error: null,
  }),
  useRemoteCalendarsQuery: (account: string | null) => ({
    data: account
      ? {
          calendars: [
            {
              href: 'https://example.test/dav/one/',
              name: 'Team',
              description: 'Shared dates',
              colour: '#ff0000',
              readonly: false,
              linked: '',
            },
            {
              href: 'https://example.test/dav/two/',
              name: 'Already here',
              description: '',
              colour: '',
              readonly: false,
              linked: 'c9',
            },
          ],
        }
      : undefined,
    isLoading: false,
    error: null,
  }),
  useLinkCalendarMutation: () => ({ mutateAsync: link, isPending: linking }),
  useSubscribeCalendarMutation: () => ({
    mutateAsync: subscribe,
    isPending: subscribing,
  }),
  useGrantCalendarMutation: () => ({ mutateAsync: grant }),
}))

function show(account?: string | null) {
  const queryClient = new QueryClient()
  const tree = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <SubscribeDialog open={open} onOpenChange={vi.fn()} account={account} />
      </I18nProvider>
    </QueryClientProvider>
  )
  const { container, rerender } = render(tree(true))
  return {
    close: () => rerender(tree(false)),
    // Whether a request the client keeps, or any component's state, still
    // carries the text.
    holds: (secret: string) =>
      queryClient
        .getMutationCache()
        .getAll()
        .some((mutation) => JSON.stringify(mutation.state).includes(secret)) ||
      stateHolds(container, secret),
  }
}

type Fiber = {
  child: Fiber | null
  sibling: Fiber | null
  memoizedState: unknown
}

// Walks the rendered tree's hook state for a string containing the text.
function stateHolds(container: HTMLElement, secret: string): boolean {
  const key = Object.keys(container).find((name) =>
    name.startsWith('__reactContainer$')
  )
  const visit = (fiber: Fiber | null): boolean => {
    for (let node = fiber; node; node = node.sibling) {
      let hook = node.memoizedState as {
        memoizedState?: unknown
        next?: unknown
      } | null
      while (hook && typeof hook === 'object' && 'next' in hook) {
        const value = hook.memoizedState
        if (typeof value === 'string' && value.includes(secret)) return true
        hook = hook.next as typeof hook
      }
      if (visit(node.child)) return true
    }
    return false
  }
  const root = (container as unknown as Record<string, Fiber>)[key ?? '']
  return visit(root ?? null)
}

describe('SubscribeDialog', () => {
  beforeEach(() => {
    link.mockClear()
    subscribe.mockClear()
    grant.mockClear()
    connect.mockClear()
    providers = ['google']
    administrator = false
    accounts = everyone
    linking = false
    subscribing = false
  })

  it('asks for the kind first, sorted by name, and offers no action until one is picked', () => {
    show()
    const titles = screen
      .getAllByRole('button')
      .map((button) => button.textContent?.trim() ?? '')
      .filter((text) =>
        [
          'Google Calendar',
          'Apple iCloud',
          'Another Mochi or CalDAV server',
          'Published calendar address (read-only)',
        ].includes(text)
      )
    expect(titles).toEqual([
      'Another Mochi or CalDAV server',
      'Apple iCloud',
      'Google Calendar',
      'Published calendar address (read-only)',
    ])
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('shows the Google accounts with consent for one without access, and Connect Google', () => {
    show()
    fireEvent.click(screen.getByText('Google Calendar'))
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    expect(
      screen.getByText('someone@example.test').closest('button')
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Allow calendar access' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Connect Google' })
    ).toBeInTheDocument()
    // The other kinds' accounts stay out of this list.
    expect(screen.queryByText('Work server')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Apple iCloud')).toBeInTheDocument()
  })

  it('keeps Google for a user who holds a Google account although the server has no client', () => {
    providers = []
    show()
    fireEvent.click(screen.getByText('Google Calendar'))
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull()
    expect(screen.queryByText(/have not been enabled/)).toBeNull()
  })

  it('hides Google from a user who could do nothing about the missing client', () => {
    providers = []
    accounts = []
    show()
    expect(screen.queryByText('Google Calendar')).toBeNull()
    expect(screen.getByText('Apple iCloud')).toBeInTheDocument()
  })

  it('tells a user with no Google account to connect one', () => {
    accounts = []
    show()
    fireEvent.click(screen.getByText('Google Calendar'))
    expect(
      screen.getByText("You haven't connected a Google account.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Connect Google' })
    ).toBeInTheDocument()
  })

  it('guides an administrator to the system settings when the server has no Google client', () => {
    providers = []
    administrator = true
    accounts = []
    show()
    fireEvent.click(screen.getByText('Google Calendar'))
    expect(
      screen.getByText('Google accounts have not been enabled on this server.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Enable Google accounts' })
    ).toBeInTheDocument()
  })

  it('connects a CalDAV account from the form, then links one of its calendars', async () => {
    show()
    fireEvent.click(screen.getByText('Another Mochi or CalDAV server'))
    // An existing account of the kind is offered above the form.
    expect(screen.getByText('Work server')).toBeInTheDocument()
    const connectButton = screen.getByRole('button', { name: 'Connect' })
    expect(connectButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://home.test/dav/' },
    })
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'me' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    })
    expect(connectButton).toBeEnabled()
    fireEvent.click(connectButton)
    await vi.waitFor(() =>
      expect(connect).toHaveBeenCalledWith({
        type: 'caldav',
        url: 'https://home.test/dav/',
        username: 'me',
        password: 'secret',
        label: '',
      })
    )
    // The made account is opened: its calendars show, the linked one marked.
    expect(await screen.findByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Linked')).toBeInTheDocument()
    expect(screen.getByText('Already here').closest('button')).toBeDisabled()
    const submit = screen.getByRole('button', { name: 'Link' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByText('Team'))
    expect(screen.getByLabelText('Name')).toHaveValue('Team')
    fireEvent.click(submit)
    await vi.waitFor(() =>
      expect(link).toHaveBeenCalledWith({
        account: 'a3',
        collection: 'https://example.test/dav/one/',
        name: 'Team',
        colour: '#ff0000',
      })
    )
  })

  it('keeps no copy of the account password once the wizard closes', async () => {
    const wizard = show()
    fireEvent.click(screen.getByText('Another Mochi or CalDAV server'))
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://home.test/dav/' },
    })
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'me' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'hunter2-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Team')).toBeInTheDocument()
    expect(wizard.holds('hunter2-secret')).toBe(true)
    wizard.close()
    await waitFor(() => expect(wizard.holds('hunter2-secret')).toBe(false))
  })

  it('stops every name field at the 100 characters the server accepts', async () => {
    show()
    fireEvent.click(screen.getByText('Another Mochi or CalDAV server'))
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '100')
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://home.test/dav/' },
    })
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'me' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Team')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Team'))
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '100')
  })

  it('stops a published address subscription name at 100 characters', () => {
    show()
    fireEvent.click(screen.getByText('Published calendar address (read-only)'))
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '100')
  })

  it('asks Apple for an Apple ID and an app-specific password', () => {
    show()
    fireEvent.click(screen.getByText('Apple iCloud'))
    expect(screen.getByLabelText('Apple ID')).toBeInTheDocument()
    expect(screen.getByLabelText('App-specific password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Server address')).toBeNull()
  })

  it('subscribes to a published address with the read-only form', async () => {
    show()
    fireEvent.click(screen.getByText('Published calendar address (read-only)'))
    const submit = screen.getByRole('button', { name: 'Subscribe' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Address'), {
      target: { value: 'example.test/cal.ics' },
    })
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Holidays' },
    })
    fireEvent.click(submit)
    await vi.waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith({
        url: 'https://example.test/cal.ics',
        name: 'Holidays',
        colour: '#2dd4bf',
      })
    )
  })

  it('connects once for Enter pressed again while the account is being tried', async () => {
    let finish: () => void = () => {}
    connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              account: {
                id: 'a3',
                type: 'caldav',
                label: '',
                identifier: 'https://home.test/dav/',
                granted: ['calendar'],
              },
            })
        })
    )
    show()
    fireEvent.click(screen.getByText('Another Mochi or CalDAV server'))
    const password = screen.getByLabelText('Password')
    fireEvent.change(screen.getByLabelText('Server address'), {
      target: { value: 'https://home.test/dav/' },
    })
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'me' },
    })
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.keyDown(password, { key: 'Enter' })
    // A second press comes a moment later, once the request says it is
    // pending, as a hand's would.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    fireEvent.keyDown(password, { key: 'Enter' })
    await act(async () => finish())
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('connects nothing for Enter before the account is filled in', async () => {
    show()
    fireEvent.click(screen.getByText('Another Mochi or CalDAV server'))
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(connect).not.toHaveBeenCalled()
  })

  it('links nothing for Enter while a link is under way', () => {
    linking = true
    show('a2')
    fireEvent.click(screen.getByText('Team'))
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(link).not.toHaveBeenCalled()
  })

  it('subscribes nothing for Enter while a subscription is under way', () => {
    subscribing = true
    show()
    fireEvent.click(screen.getByText('Published calendar address (read-only)'))
    const address = screen.getByLabelText('Address')
    fireEvent.change(address, { target: { value: 'example.test/cal.ics' } })
    fireEvent.keyDown(address, { key: 'Enter' })
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('starts at the calendars when opened with a granted account, and Back returns to its kind', () => {
    show('a2')
    expect(screen.getByText('Team')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('button', { name: 'Connect Google' })
    ).toBeInTheDocument()
  })
})
