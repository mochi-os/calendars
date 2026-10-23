// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
//
// A new event's accounts on other networks: the switches start from its
// calendar's list, and a change to them goes with the create.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEditor } from './editor'

const { noon, state } = vi.hoisted(() => ({
  noon: Date.UTC(2026, 8, 25, 12) / 1000,
  state: {
    create: vi.fn(),
    publish: vi.fn(),
    kind: 'own',
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('@/hooks/use-event-move', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/hooks/use-event-move')>()
  return { ...original, useOccurrenceMove: () => vi.fn() }
})
vi.mock('@/context/calendar-context', async () => {
  const { newDraft } =
    await vi.importActual<typeof import('@/lib/ical')>('@/lib/ical')
  const creating = {
    mode: 'create',
    draft: newDraft(noon, noon + 3600, {
      allday: false,
      calendar: 'c1',
      reminder: -1,
      user: 'UTC',
      zone: { start: 'UTC', finish: 'UTC' },
    }),
  }
  const context = {
    editing: creating,
    setEditing: vi.fn(),
    get ordered() {
      return [
        {
          id: 'c1',
          name: 'Personal',
          readonly: false,
          default: true,
          kind: state.kind,
        },
      ]
    },
    preferences: { hours: { start: 8, finish: 17 }, duration: 60 },
    remember: vi.fn(),
    reveal: vi.fn(),
  }
  return { useCalendarContext: () => context }
})
vi.mock('@/hooks/use-events', () => ({
  useEventQuery: () => ({
    data: undefined,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCreateEventMutation: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useUpdateEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSplitEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/api/calendars', () => ({
  calendarsApi: {
    publish: (calendar: string) => state.publish(calendar),
  },
}))

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider i18n={i18n}>
        <EventEditor />
      </I18nProvider>
    </QueryClientProvider>
  )
}

async function titled() {
  fireEvent.change(await screen.findByLabelText('Title'), {
    target: { value: 'Launch party' },
  })
}

describe('New event accounts', () => {
  beforeEach(() => {
    i18n.load('en', {})
    i18n.activate('en')
    state.kind = 'own'
    state.create = vi.fn().mockResolvedValue({ event: {} })
    state.publish = vi.fn().mockResolvedValue({
      accounts: [
        {
          id: 'f1',
          type: 'fediverse',
          identifier: '@alice@example.org',
          name: 'Alice',
          hosted: true,
        },
        {
          id: 'b1',
          type: 'bluesky',
          identifier: 'alice.example.org',
          name: 'Alice',
          hosted: true,
        },
      ],
      publish: ['f1'],
      copies: {},
    })
  })

  it("leaves the accounts to the calendar's list when untouched", async () => {
    show()
    await titled()
    expect(
      await screen.findByRole('switch', { name: '@alice@example.org' })
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1))
    expect(state.create.mock.calls[0][0].accounts).toBeUndefined()
  })

  it('sends the accounts chosen for the event', async () => {
    show()
    await titled()
    fireEvent.click(
      await screen.findByRole('switch', { name: 'alice.example.org' })
    )
    fireEvent.click(screen.getByRole('switch', { name: '@alice@example.org' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1))
    expect(state.create.mock.calls[0][0].accounts).toEqual(['b1'])
  })

  it('offers no accounts for a calendar that does not publish', async () => {
    state.kind = 'linked'
    show()
    await titled()
    expect(screen.queryByText('Publish to')).toBeNull()
    expect(state.publish).not.toHaveBeenCalled()
  })
})
