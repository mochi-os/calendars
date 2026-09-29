// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIcsCopy } from '@/hooks/use-ics-copy'
import { AddressDialogs } from './address-dialogs'

const { address, addressRevoke, info } = vi.hoisted(() => ({
  address: vi.fn(),
  addressRevoke: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/api/calendars', () => ({
  calendarsApi: { address, addressRevoke },
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    toast: { ...original.toast, info, success: vi.fn(), error: vi.fn() },
  }
})

function Harness() {
  const { copy, revoke, dialogs } = useIcsCopy()
  return (
    <>
      <button onClick={() => void copy('c1')}>copy</button>
      <button onClick={() => revoke('c1')}>revoke</button>
      <AddressDialogs state={dialogs} />
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

describe('calendar address', () => {
  beforeEach(() => {
    address.mockReset()
    addressRevoke.mockReset().mockResolvedValue({})
    info.mockReset()
  })

  it('shows a new address in a dialog rather than only copying it', async () => {
    address.mockResolvedValue({
      token: 'secret',
      path: '/calendars/abc/calendar.ics',
    })
    show()
    fireEvent.click(screen.getByText('copy'))
    expect(
      await screen.findByText(
        `${window.location.origin}/calendars/abc/calendar.ics?token=secret`
      )
    ).toBeInTheDocument()
  })

  it('revokes only after the confirm', async () => {
    show()
    fireEvent.click(screen.getByText('revoke'))
    expect(screen.getByText('Revoke calendar address?')).toBeInTheDocument()
    expect(addressRevoke).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(addressRevoke).toHaveBeenCalledWith('c1'))
  })

  it('replaces an issued address only after the confirm', async () => {
    address.mockResolvedValueOnce({ exists: true })
    show()
    fireEvent.click(screen.getByText('copy'))
    await waitFor(() => expect(info).toHaveBeenCalled())
    expect(address).toHaveBeenCalledTimes(1)

    // The toast's Replace opens the confirm; it does not replace by itself.
    const action = info.mock.calls[0][1].action as { onClick: () => void }
    address.mockResolvedValueOnce({
      token: 'new',
      path: '/calendars/abc/calendar.ics',
    })
    act(action.onClick)
    expect(screen.getByText('Replace calendar address?')).toBeInTheDocument()
    expect(address).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(address).toHaveBeenLastCalledWith('c1', true))
  })
})
