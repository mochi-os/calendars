// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from './connect-dialog'

const tokens = [
  // Connected from the other app: the same password serves both.
  {
    hash: 'h1',
    name: 'Phone',
    scopes: ['dav'],
    action: 'carddav/*path',
    entity: '',
    created: 1,
    used: 0,
    expires: 0,
  },
  {
    hash: 'h2',
    name: 'Tablet',
    scopes: ['dav'],
    action: 'caldav/*path',
    entity: '',
    created: 1,
    used: 0,
    expires: 0,
  },
  // An address link is a token too, and not a device.
  {
    hash: 'h3',
    name: 'Link',
    scopes: ['ics'],
    action: ':calendar/calendar.ics',
    entity: 'c1',
    created: 1,
    used: 0,
    expires: 0,
  },
]

const { create, list, post } = vi.hoisted(() => {
  const create = vi.fn()
  const list = vi.fn()
  // Every request the dialog makes, as the request layer receives it.
  const post = vi.fn((url: string, body: string, config?: unknown) => {
    void config
    if (url.endsWith('token/list')) return list()
    if (url.endsWith('token/create'))
      return create(new URLSearchParams(body).get('name'))
    return Promise.resolve({ ok: true })
  })
  return { create, list, post }
})

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    requestHelpers: { ...original.requestHelpers, post },
    toast: { success: vi.fn(), error: vi.fn() },
    toastAction: (promise: Promise<unknown>) => promise,
    shellClipboardWrite: vi.fn().mockResolvedValue(true),
    getAppPath: () => '/calendars',
  }
})

function show() {
  const onOpenChange = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const tree = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <ConnectDialog open={open} onOpenChange={onOpenChange} />
      </I18nProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(tree(true))
  return {
    onOpenChange,
    close: () => rerender(tree(false)),
    // Whether any request the client still holds carries the password.
    holds: (secret: string) =>
      queryClient
        .getMutationCache()
        .getAll()
        .some((mutation) => JSON.stringify(mutation.state).includes(secret)),
  }
}

async function add(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add device' }))
  fireEvent.change(screen.getByLabelText('Device name'), {
    target: { value: name },
  })
}

describe('ConnectDialog', () => {
  beforeEach(() => {
    post.mockClear()
    create.mockReset().mockResolvedValue({
      token: 'mochi-secret',
      username: 'created@example.test',
    })
    list
      .mockReset()
      .mockResolvedValue({ tokens, username: 'someone@example.test' })
  })

  it('opens on the devices, with the server, the address and the username', async () => {
    show()
    expect(await screen.findByText('Phone')).toBeInTheDocument()
    expect(
      screen.getByText(`${window.location.origin}/calendars/caldav/`)
    ).toBeInTheDocument()
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add device' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Device name')).toBeNull()
  })

  it('closes on Cancel', () => {
    const { onOpenChange } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lists the devices connected from either app, and no address link', async () => {
    show()
    expect(await screen.findByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('Tablet')).toBeInTheDocument()
    expect(screen.queryByText('Link')).toBeNull()
  })

  it('adds a device and shows its password once, beside the account address', async () => {
    show()
    await add('My phone')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(create).toHaveBeenCalledWith('My phone')
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('mochi-secret')).toBeNull()
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })

  it("takes the new device's own username when the list has none", async () => {
    list.mockResolvedValue({ tokens, username: '' })
    show()
    await add('My phone')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(screen.getByText('created@example.test')).toBeInTheDocument()
  })

  it('keeps no copy of the password once Done is pressed', async () => {
    const dialog = show()
    await add('My phone')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(dialog.holds('mochi-secret')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(dialog.holds('mochi-secret')).toBe(false))
  })

  it('keeps no copy of the password once the dialog closes', async () => {
    const dialog = show()
    await add('My phone')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    dialog.close()
    await waitFor(() => expect(dialog.holds('mochi-secret')).toBe(false))
  })

  it('makes one device when Enter is pressed again while it is being made', async () => {
    let finish: (value: unknown) => void = () => {}
    create.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    show()
    await add('My phone')
    const field = screen.getByLabelText('Device name')
    // Presses a key-repeat apart, which is far longer than the query client
    // takes to publish that the request is under way.
    for (let press = 0; press < 3; press++) {
      fireEvent.keyDown(field, { key: 'Enter' })
      await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    }
    finish({ token: 'mochi-secret', username: 'created@example.test' })
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('shows a failed device list as a failure, not as no devices', async () => {
    list.mockRejectedValue(new Error('The server did not answer'))
    show()
    expect(
      await screen.findByText('The server did not answer')
    ).toBeInTheDocument()
    expect(screen.queryByText('No devices connected.')).toBeNull()
  })

  it('reads the device list quietly, so a failure is shown once, in place', async () => {
    show()
    await screen.findByText('Phone')
    const call = post.mock.calls.find(([url]) => url.endsWith('token/list'))
    expect(call?.[2]).toMatchObject({ mochi: { showGlobalErrorToast: false } })
  })

  it('confirms a delete with a destructive button that names both apps it stops', async () => {
    show()
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Delete device' }))[0]
    )
    expect(
      screen.getByText(
        'The device will no longer be able to sync contacts or calendars.'
      )
    ).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm.className).toContain('bg-destructive')
    expect(confirm.querySelector('svg')).not.toBeNull()
  })
})
