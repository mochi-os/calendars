// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIcsCopy } from './use-ics-copy'

const api = vi.hoisted(() => ({ address: vi.fn(), addressRevoke: vi.fn() }))
const shell = vi.hoisted(() => ({
  clipboard: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/api/calendars', () => ({ calendarsApi: api }))
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    shellClipboardWrite: shell.clipboard,
    toast: { success: shell.success, info: shell.info, error: shell.error },
  }
})

function Harness() {
  const { copy, revoke, dialogs } = useIcsCopy()
  return (
    <>
      <button onClick={() => void copy('c1')}>copy</button>
      <button onClick={() => revoke('c1')}>revoke</button>
      {dialogs}
    </>
  )
}

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <Harness />
    </I18nProvider>
  )
}

describe('useIcsCopy', () => {
  beforeEach(() => {
    api.address.mockReset().mockResolvedValue({
      token: 'mochi-secret',
      path: '/calendars/abc/calendar.ics',
      exists: false,
    })
    api.addressRevoke.mockReset()
    for (const f of Object.values(shell)) f.mockReset()
  })

  it('shows the new address to copy by hand when the clipboard refuses it', async () => {
    shell.clipboard.mockResolvedValue(false)
    show()
    fireEvent.click(screen.getByText('copy'))
    const field = await screen.findByRole('textbox', {
      name: 'Calendar address',
    })
    expect(field).toHaveValue(
      `${window.location.origin}/calendars/abc/calendar.ics?token=mochi-secret`
    )
    expect(shell.success).not.toHaveBeenCalled()
  })

  it('says the address was copied when the clipboard takes it', async () => {
    shell.clipboard.mockResolvedValue(true)
    show()
    fireEvent.click(screen.getByText('copy'))
    await waitFor(() => expect(shell.success).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before revoking, then revokes', async () => {
    api.addressRevoke.mockResolvedValue({ revoked: true })
    show()
    fireEvent.click(screen.getByText('revoke'))
    expect(
      await screen.findByText('Revoke the calendar address?')
    ).toBeInTheDocument()
    expect(api.addressRevoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(api.addressRevoke).toHaveBeenCalledWith('c1'))
    await waitFor(() =>
      expect(shell.success).toHaveBeenCalledWith('Calendar address revoked')
    )
    expect(shell.info).not.toHaveBeenCalled()
  })

  it('says so when there was no address to revoke', async () => {
    api.addressRevoke.mockResolvedValue({ revoked: false })
    show()
    fireEvent.click(screen.getByText('revoke'))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await waitFor(() =>
      expect(shell.info).toHaveBeenCalledWith(
        'This calendar has no address to revoke'
      )
    )
    expect(shell.success).not.toHaveBeenCalled()
  })

  it('revokes nothing when the question is cancelled', async () => {
    show()
    fireEvent.click(screen.getByText('revoke'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByText('Revoke the calendar address?')).toBeNull()
    )
    expect(api.addressRevoke).not.toHaveBeenCalled()
  })
})
