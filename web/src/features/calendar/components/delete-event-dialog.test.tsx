// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteEventDialog } from './delete-event-dialog'

const { stored, create, remove, update, success, pending, loaded } = vi.hoisted(
  () => ({
    stored: {
      id: 'e1',
      calendar: 'c1',
      etag: 'v1',
      recurring: false,
      components: [{ name: 'VEVENT', properties: [], components: [] }],
    },
    create: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    success: vi.fn(),
    pending: { value: false },
    loaded: { value: true },
  })
)

vi.mock('@/hooks/use-events', () => ({
  useEventQuery: () => ({
    data: loaded.value ? { event: stored } : undefined,
    refetch: vi.fn(),
  }),
  useCreateEventMutation: () => ({ mutateAsync: create, isPending: false }),
  useDeleteEventMutation: () => ({
    mutateAsync: remove,
    isPending: pending.value,
  }),
  useUpdateEventMutation: () => ({ mutateAsync: update, isPending: false }),
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    toast: { ...original.toast, success, error: vi.fn() },
  }
})

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <DeleteEventDialog event='e1' start={0} onClose={vi.fn()} />
    </I18nProvider>
  )
}

describe('DeleteEventDialog', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({})
    remove.mockReset().mockResolvedValue({})
    success.mockReset()
    pending.value = false
    loaded.value = true
  })

  it('waits for the stored event, showing the scope the listing gave', () => {
    loaded.value = false
    render(
      <I18nProvider i18n={i18n}>
        <DeleteEventDialog event='e1' start={0} recurring onClose={vi.fn()} />
      </I18nProvider>
    )
    const all = screen.getByRole('button', { name: 'All events' })
    expect(all).toBeDisabled()
    fireEvent.click(all)
    expect(remove).not.toHaveBeenCalled()
  })

  it('offers Undo, which puts the deleted event back', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(success).toHaveBeenCalled())
    expect(remove).toHaveBeenCalledWith({ event: 'e1', etag: 'v1' })

    const { action } = success.mock.calls[0][1] as {
      action: { label: string; onClick: () => void }
    }
    expect(action.label).toBe('Undo')
    act(action.onClick)
    expect(create).toHaveBeenCalledWith({
      calendar: 'c1',
      components: stored.components,
    })
  })

  it('cannot be chosen again while the delete runs', () => {
    pending.value = true
    show()
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(remove).not.toHaveBeenCalled()
  })
})
