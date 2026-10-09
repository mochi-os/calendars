// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '@/hooks/use-preferences'
import { CalendarProvider, useCalendarContext } from './calendar-context'

// What the provider reads: the view this browser stored, the shared
// preferences, the calendar list's state, and what it saves.
const state = vi.hoisted(() => ({
  stored: null as string | null,
  view: 'month',
  failed: false,
  refetch: vi.fn(),
  save: vi.fn(),
  search: {} as Record<string, string>,
}))

beforeEach(() => {
  state.stored = null
  state.view = 'month'
  state.failed = false
  state.refetch.mockReset()
  state.save.mockReset()
  state.search = {}
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => state.search,
}))
vi.mock('@/hooks/use-calendars', () => ({
  useCalendarsQuery: () => ({
    data: state.failed ? undefined : { calendars: [] },
    isLoading: false,
    isError: state.failed,
    refetch: state.refetch,
  }),
  useCalendarsRefresh: () => undefined,
}))
vi.mock('@/hooks/use-preferences', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/use-preferences')>()
  return {
    ...original,
    usePreferencesQuery: () => ({
      data: { preferences: { ...original.DEFAULTS, view: state.view } },
    }),
    useSetPreferencesMutation: () => ({ mutate: state.save }),
  }
})
vi.mock('@/hooks/use-shown', () => ({
  useShownCalendars: () => ({
    shown: () => true,
    toggle: vi.fn(),
    reveal: vi.fn(),
    only: vi.fn(),
    visible: [],
  }),
}))
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    useScreenSize: () => ({ isDesktop: true }),
    // The view is the one key read from storage here; the rest start empty.
    useShellStorage: <T,>(key: string, fallback: T) =>
      key === 'calendars:view'
        ? [(state.stored ?? fallback) as T, vi.fn()]
        : [fallback, vi.fn()],
  }
})

function provide() {
  const seen: { current: ReturnType<typeof useCalendarContext> | null } = {
    current: null,
  }
  function Reader() {
    seen.current = useCalendarContext()
    return null
  }
  render(
    <CalendarProvider>
      <Reader />
    </CalendarProvider>
  )
  return seen
}

describe('CalendarProvider list', () => {
  it('holds the day atop the list under its anchor, and lets it go with the anchor or the view', () => {
    state.search = { view: 'list', date: '2026-09-22' }
    const seen: { current: ReturnType<typeof useCalendarContext> | null } = {
      current: null,
    }
    function Reader() {
      seen.current = useCalendarContext()
      return null
    }
    const tree = () => (
      <CalendarProvider>
        <Reader />
      </CalendarProvider>
    )
    const { rerender } = render(tree())
    expect(seen.current?.listed).toBeUndefined()
    act(() => seen.current?.setListed('2026-10-12'))
    expect(seen.current?.listed).toBe('2026-10-12')
    state.search = { view: 'month', date: '2026-09-22' }
    rerender(tree())
    expect(seen.current?.listed).toBeUndefined()
    state.search = { view: 'list', date: '2026-09-22' }
    rerender(tree())
    expect(seen.current?.listed).toBe('2026-10-12')
    state.search = { view: 'list', date: '2026-11-01' }
    rerender(tree())
    expect(seen.current?.listed).toBeUndefined()
  })
})

describe('CalendarProvider', () => {
  it('opens a browser that has shown no view on the view last chosen anywhere', () => {
    state.view = 'week'
    expect(provide().current?.view).toBe('week')
  })

  it("opens a browser on its own last view over the shared one", () => {
    state.view = 'week'
    state.stored = 'day'
    expect(provide().current?.view).toBe('day')
  })

  it('saves a chosen view as the one a new browser or device opens on', () => {
    const seen = provide()
    act(() => seen.current?.setView('list'))
    expect(state.save).toHaveBeenCalledWith({ view: 'list' })
  })

  it('saves nothing when the view chosen is the one already shared', () => {
    const seen = provide()
    act(() => seen.current?.setView(DEFAULTS.view))
    expect(state.save).not.toHaveBeenCalled()
  })

  it('says when the calendar list could not be read, and asks for it again', () => {
    state.failed = true
    const seen = provide()
    expect(seen.current?.failed).toBe(true)
    act(() => seen.current?.reload())
    expect(state.refetch).toHaveBeenCalledTimes(1)
  })
})
