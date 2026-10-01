// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Instance } from '@/api/types/events'
import { useReminder } from './use-reminder'

const api = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/events', () => ({ eventsApi: api }))

const occurrence = { event: 'e1', start: 100 } as Instance

function setup(props: Partial<Parameters<typeof useReminder>[0]> = {}) {
  const open = vi.fn()
  const clear = vi.fn()
  const reveal = vi.fn()
  const initial = {
    event: 'e1',
    occurrence: 100,
    instances: [] as Instance[],
    loading: false,
    visible: [{ id: 'c1' }],
    reveal,
    open,
    clear,
    ...props,
  }
  const hook = renderHook((current) => useReminder(current), {
    initialProps: initial,
  })
  return { open, clear, reveal, initial, ...hook }
}

describe('useReminder', () => {
  beforeEach(() => {
    api.get.mockReset()
  })

  it('opens the occurrence once it has loaded, and drops the link', () => {
    const { open, clear } = setup({ instances: [occurrence] })
    expect(open).toHaveBeenCalledWith(occurrence, 'e1:100')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(api.get).not.toHaveBeenCalled()
  })

  it('waits while the shown calendars load', () => {
    const { open, clear } = setup({ loading: true })
    expect(open).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })

  it("shows the event's hidden calendar, then opens the occurrence as it arrives", async () => {
    api.get.mockResolvedValue({ event: { id: 'e1', calendar: 'c2' } })
    const { open, clear, reveal, initial, rerender } = setup()
    await waitFor(() => expect(reveal).toHaveBeenCalledWith('c2'))
    expect(clear).not.toHaveBeenCalled()
    rerender({ ...initial, loading: true })
    rerender({ ...initial, instances: [occurrence] })
    expect(open).toHaveBeenCalledWith(occurrence, 'e1:100')
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('drops the link when the calendar is shown and the occurrence has gone', async () => {
    api.get.mockResolvedValue({ event: { id: 'e1', calendar: 'c1' } })
    const { clear, reveal } = setup()
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
    expect(reveal).not.toHaveBeenCalled()
  })

  it('drops the link when the event cannot be read', async () => {
    api.get.mockRejectedValue(new Error('gone'))
    const { clear, reveal } = setup()
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
    expect(reveal).not.toHaveBeenCalled()
  })

  it('does nothing without a link', () => {
    const { open, clear } = setup({ event: undefined })
    expect(open).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(api.get).not.toHaveBeenCalled()
  })
})
