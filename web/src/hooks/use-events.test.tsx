// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDeleteEventMutation,
  useInstancePages,
  useUpdateEventMutation,
} from './use-events'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  split: vi.fn(),
  list: vi.fn(),
}))

vi.mock('@/api/events', () => ({ eventsApi: api }))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Cached queries as a page holds them: two events, the instances, the bounds.
  queryClient.setQueryData(['event', 'e1'], { event: { id: 'e1' } })
  queryClient.setQueryData(['event', 'e2'], { event: { id: 'e2' } })
  queryClient.setQueryData(['instances', 0, 1, 'c1', 'UTC'], { instances: [] })
  queryClient.setQueryData(['bounds'], { start: 0, finish: 1 })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false
  return { queryClient, wrapper, invalidated }
}

describe('event mutations', () => {
  beforeEach(() => {
    api.delete.mockReset().mockResolvedValue({})
    api.update.mockReset().mockResolvedValue({ event: { id: 'e1' } })
  })

  it('leaves the deleted event out of the refresh, so nothing fetches it again', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useDeleteEventMutation(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ event: 'e1', etag: '"1"' })
    })
    expect(api.delete).toHaveBeenCalledWith('e1', '"1"')
    expect(invalidated(['event', 'e1'])).toBe(false)
    expect(invalidated(['event', 'e2'])).toBe(true)
    expect(invalidated(['instances', 0, 1, 'c1', 'UTC'])).toBe(true)
    expect(invalidated(['bounds'])).toBe(true)
  })

  it('refreshes an updated event, which still exists', async () => {
    const { wrapper, invalidated } = setup()
    const { result } = renderHook(() => useUpdateEventMutation(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        event: 'e1',
        etag: '"1"',
        components: [],
      })
    })
    expect(invalidated(['event', 'e1'])).toBe(true)
    expect(invalidated(['event', 'e2'])).toBe(true)
  })
})

describe('the list view pages', () => {
  const pages = [
    { start: 0, finish: 100 },
    { start: 100, finish: 200 },
  ]
  // An overnight occurrence from 90 to 110 overlaps both pages, and each
  // answers it.
  const across = { event: 'e1', start: 90, finish: 110 }

  beforeEach(() => {
    api.list.mockReset()
  })

  it('lists an occurrence crossing from one page into the next once', async () => {
    api.list.mockImplementation((start: number) =>
      Promise.resolve({
        instances:
          start === 0
            ? [{ event: 'e0', start: 10, finish: 20 }, across]
            : [across, { event: 'e2', start: 150, finish: 160 }],
      })
    )
    const { wrapper } = setup()
    const { result } = renderHook(
      () => useInstancePages(pages, ['c1'], 'UTC'),
      { wrapper }
    )
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.instances.map((item) => item.event)).toEqual([
      'e0',
      'e1',
      'e2',
    ])
    expect(result.current.failed).toBe(false)
  })

  it('says a page failed, and asks again for that page alone', async () => {
    api.list.mockImplementation((start: number) =>
      start === 0
        ? Promise.resolve({ instances: [] })
        : Promise.reject(new Error('down'))
    )
    const { wrapper } = setup()
    const { result } = renderHook(
      () => useInstancePages(pages, ['c1'], 'UTC'),
      { wrapper }
    )
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(api.list).toHaveBeenCalledTimes(2)
    api.list.mockResolvedValue({ instances: [] })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.failed).toBe(false))
    expect(api.list).toHaveBeenCalledTimes(3)
    expect(api.list.mock.calls[2][0]).toBe(100)
  })
})
