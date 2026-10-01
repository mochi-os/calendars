// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteEventDialog } from './delete-event-dialog'

const event = {
  id: 'e1',
  calendar: 'c1',
  etag: 'x1',
  recurring: false,
  components: [],
}

// The event as the query answers it, and the delete it goes through.
const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  remove: vi.fn(),
  pending: false,
}))

beforeEach(() => {
  state.query = {
    data: { event },
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
  state.remove = vi.fn().mockResolvedValue({})
  state.pending = false
})

vi.mock('@/hooks/use-events', () => ({
  useEventQuery: () => state.query,
  useDeleteEventMutation: () => ({
    mutateAsync: state.remove,
    isPending: state.pending,
  }),
  useUpdateEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function show() {
  const onClose = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <DeleteEventDialog event='e1' start={0} onClose={onClose} />
    </I18nProvider>
  )
  return onClose
}

describe('DeleteEventDialog', () => {
  it('holds Delete back until the event has loaded', () => {
    state.query = { ...state.query, data: undefined }
    show()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('says the event could not be read, with a way to try again', () => {
    state.query = {
      data: undefined,
      isError: true,
      error: new Error('offline'),
      refetch: vi.fn(),
    }
    show()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.query.refetch).toHaveBeenCalledTimes(1)
  })

  it('deletes once for a double click', async () => {
    let finish: () => void = () => {}
    state.remove = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    const onClose = show()
    const button = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => finish())
    expect(state.remove).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('holds its choices while the delete runs', () => {
    state.pending = true
    show()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
