// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarsRefresh } from './use-calendars'

const api = vi.hoisted(() => ({ refresh: vi.fn() }))

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
