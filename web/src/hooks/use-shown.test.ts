// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Calendar } from '@/api/types/calendars'
import { useShownCalendars } from './use-shown'

const calendars = [{ id: 'standard' }, { id: 'work' }] as Calendar[]

describe('useShownCalendars', () => {
  it('shows a hidden calendar again when an event is saved into it, and leaves a shown one be', () => {
    const { result } = renderHook(() => useShownCalendars(calendars))
    act(() => result.current.toggle('work'))
    expect(result.current.shown('work')).toBe(false)
    act(() => result.current.reveal('work'))
    expect(result.current.shown('work')).toBe(true)
    act(() => result.current.reveal('standard'))
    expect(result.current.shown('standard')).toBe(true)
    expect(result.current.visible.map((calendar) => calendar.id)).toEqual([
      'standard',
      'work',
    ])
  })
})
