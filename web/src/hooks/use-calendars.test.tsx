// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useCalendarAccountsQuery,
  useCalendarsRefresh,
  useDeleteCalendarMutation,
  useLinkCalendarMutation,
  useRemoteCalendarsQuery,
  useRenameCalendarMutation,
} from './use-calendars'

const api = vi.hoisted(() => ({
  refresh: vi.fn(),
  rename: vi.fn(),
  delete: vi.fn(),
  link: vi.fn(),
  remote: vi.fn(),
  accounts: vi.fn(),
}))

vi.mock('@/api/calendars', () => ({ calendarsApi: api }))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Cached queries as a page holds them: the calendars, the instances, the bounds.
  queryClient.setQueryData(['calendars'], { calendars: [] })
  queryClient.setQueryData(['instances', 0, 1, 'c1', 'UTC'], { instances: [] })
  queryClient.setQueryData(['bounds'], { start: 0, finish: 1 })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false
  return { wrapper, invalidated }
}

describe('useCalendarsRefresh', () => {
  beforeEach(() => {
    api.refresh.mockReset()
  })

  it('asks the server to sync as the calendars open, and reloads what changed', async () => {
    api.refresh.mockResolvedValue({ changed: true })
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useCalendarsRefresh(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(invalidated(['calendars'])).toBe(true)
    expect(invalidated(['instances', 0, 1, 'c1', 'UTC'])).toBe(true)
    expect(invalidated(['bounds'])).toBe(true)
  })

  it('leaves the page alone when nothing changed', async () => {
    api.refresh.mockResolvedValue({ changed: false })
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useCalendarsRefresh(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.refresh).toHaveBeenCalledTimes(1)
    expect(invalidated(['calendars'])).toBe(false)
    expect(invalidated(['instances', 0, 1, 'c1', 'UTC'])).toBe(false)
  })
})

describe('calendar changes and the remote lists', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset().mockResolvedValue({})
    api.remote.mockResolvedValue({ calendars: [] })
    api.accounts.mockResolvedValue({
      accounts: [],
      providers: [],
      administrator: false,
    })
  })

  // The wizard open on an account: its connected accounts and that account's
  // remote calendars, each fetched from the other server once.
  async function open<T>(mutation: () => T) {
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        accounts: useCalendarAccountsQuery(true),
        remote: useRemoteCalendarsQuery('a1'),
        mutation: mutation(),
      }),
      { wrapper }
    )
    await waitFor(() => {
      expect(result.current.accounts.isSuccess).toBe(true)
      expect(result.current.remote.isSuccess).toBe(true)
    })
    expect(api.remote).toHaveBeenCalledTimes(1)
    return result
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

  it('a rename does not ask the remote server or the accounts again', async () => {
    const result = await open(() => useRenameCalendarMutation())
    await result.current.mutation.mutateAsync({ calendar: 'c1', name: 'Work' })
    await settle()
    expect(api.remote).toHaveBeenCalledTimes(1)
    expect(api.accounts).toHaveBeenCalledTimes(1)
  })

  it('deleting a calendar asks the remote server again, where a linked one frees its collection', async () => {
    const result = await open(() => useDeleteCalendarMutation())
    await result.current.mutation.mutateAsync('c1')
    await waitFor(() => expect(api.remote).toHaveBeenCalledTimes(2))
    await settle()
    expect(api.accounts).toHaveBeenCalledTimes(1)
  })

  it('linking a calendar asks the remote server again, which marks it linked', async () => {
    const result = await open(() => useLinkCalendarMutation())
    await result.current.mutation.mutateAsync({
      account: 'a1',
      collection: 'https://example.test/c/',
      name: 'Remote',
      colour: '#000000',
    })
    await waitFor(() => expect(api.remote).toHaveBeenCalledTimes(2))
  })
})
