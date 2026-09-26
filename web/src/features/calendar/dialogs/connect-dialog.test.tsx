// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectDialog } from './connect-dialog'

const create = vi.fn()
const remove = vi.fn().mockResolvedValue({})
// What token/list answers for the account's username.
const listing = { username: '' }

vi.mock('@/hooks/use-tokens', () => ({
  useTokensQuery: () => ({
    data: {
      tokens: [
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
      ],
      username: listing.username,
    },
    isLoading: false,
  }),
  useCreateTokenMutation: () => ({ mutateAsync: create, isPending: false }),
  useDeleteTokenMutation: () => ({ mutateAsync: remove, isPending: false }),
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    toast: { success: vi.fn(), error: vi.fn() },
    toastAction: (promise: Promise<unknown>) => promise,
    shellClipboardWrite: vi.fn().mockResolvedValue(true),
    getAppPath: () => '/calendars',
  }
})

function show() {
  const onOpenChange = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <ConnectDialog open onOpenChange={onOpenChange} />
    </I18nProvider>
  )
  return onOpenChange
}

describe('ConnectDialog', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({
      token: 'mochi-secret',
      username: 'created@example.test',
    })
    listing.username = 'someone@example.test'
  })

  it('opens on the devices, with the server, the address and the username', () => {
    show()
    expect(
      screen.getByText(`${window.location.origin}/calendars/caldav/`)
    ).toBeInTheDocument()
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add device' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Device name')).toBeNull()
  })

  it('closes on Cancel', () => {
    const onOpenChange = show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lists the devices connected from either app, and no address link', () => {
    show()
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('Tablet')).toBeInTheDocument()
    expect(screen.queryByText('Link')).toBeNull()
  })

  it('adds a device and shows its password once, beside the account address', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    fireEvent.change(screen.getByLabelText('Device name'), {
      target: { value: 'My phone' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(create).toHaveBeenCalledWith('My phone')
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('mochi-secret')).toBeNull()
    expect(screen.getByText('Phone')).toBeInTheDocument()
  })

  it("takes the new device's own username when the list has none", async () => {
    listing.username = ''
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    fireEvent.change(screen.getByLabelText('Device name'), {
      target: { value: 'My phone' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(screen.getByText('created@example.test')).toBeInTheDocument()
  })
})
