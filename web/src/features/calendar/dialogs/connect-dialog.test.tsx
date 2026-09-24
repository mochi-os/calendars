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

vi.mock('@/hooks/use-tokens', () => ({
  useTokensQuery: () => ({
    data: {
      tokens: [
        // Connected from the other app: the same password serves both.
        { hash: 'h1', name: 'Phone', scopes: ['dav'], action: 'carddav/*path', entity: '', created: 1, used: 0, expires: 0 },
        { hash: 'h2', name: 'Tablet', scopes: ['dav'], action: 'caldav/*path', entity: '', created: 1, used: 0, expires: 0 },
        // An address link is a token too, and not a device.
        { hash: 'h3', name: 'Link', scopes: ['ics'], action: ':calendar/calendar.ics', entity: 'c1', created: 1, used: 0, expires: 0 },
      ],
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
  render(
    <I18nProvider i18n={i18n}>
      <ConnectDialog open onOpenChange={vi.fn()} />
    </I18nProvider>
  )
}

describe('ConnectDialog', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ token: 'mochi-secret', username: 'someone@example.test' })
  })

  it('shows the account address as the username beside the new password', async () => {
    show()
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'My phone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('mochi-secret')).toBeInTheDocument()
    expect(create).toHaveBeenCalledWith('My phone')
    expect(screen.getByText('someone@example.test')).toBeInTheDocument()
  })

  it('lists the devices connected from either app, and no address link', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Manage devices' }))
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText('Tablet')).toBeInTheDocument()
    expect(screen.queryByText('Link')).toBeNull()
  })
})
