// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEditor } from './editor'

const { setEditing, noon } = vi.hoisted(() => ({
  setEditing: vi.fn(),
  noon: Date.UTC(2026, 8, 25, 12) / 1000,
}))

// Built once: the editor re-reads its draft whenever `editing` changes, so a
// fresh object on every render would never settle.
vi.mock('@/context/calendar-context', async () => {
  const { newDraft } =
    await vi.importActual<typeof import('@/lib/ical')>('@/lib/ical')
  const context = {
    editing: {
      mode: 'create',
      draft: newDraft(noon, noon + 3600, {
        allday: false,
        calendar: 'c1',
        reminder: -1,
        zone: { start: 'UTC', finish: 'UTC' },
      }),
    },
    setEditing,
    calendars: [{ id: 'c1', name: 'Personal', readonly: false, default: true }],
    remember: vi.fn(),
    reveal: vi.fn(),
  }
  return { useCalendarContext: () => context }
})

vi.mock('@/hooks/use-events', () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    useEventQuery: () => ({
      data: undefined,
      isLoading: false,
      refetch: vi.fn(),
    }),
    useCreateEventMutation: mutation,
    useUpdateEventMutation: mutation,
    useSplitEventMutation: mutation,
    useDeleteEventMutation: mutation,
  }
})

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <EventEditor />
    </I18nProvider>
  )
}

describe('EventEditor closing', () => {
  beforeEach(() => setEditing.mockClear())

  it('closes an untouched form without asking', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(setEditing).toHaveBeenCalledWith(null)
    expect(screen.queryByText('Discard draft?')).toBeNull()
  })

  it('asks before Cancel throws away a change', () => {
    show()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Dentist' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(setEditing).toHaveBeenCalledWith(null)
  })

  it('asks before Escape throws away a change', () => {
    show()
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Dentist' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
  })
})
