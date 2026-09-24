// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component, Instance } from '@/api/types/events'
import {
  deletedOccurrence,
  draftComponent,
  editedComponents,
  emptyRepeat,
  propertyInstant,
  propertyValue,
  type EventDraft,
} from '@/lib/ical'
import { useEventMove } from './use-event-move'

const ZONE = 'UTC'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  split: vi.fn(),
}))
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/api/events', () => ({ eventsApi: api }))
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return { ...original, toast: toasts }
})

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: 'Standup',
    calendar: 'cal1',
    allday: false,
    start: '2026-09-16',
    startTime: 9 * 60,
    finish: '2026-09-16',
    finishTime: 10 * 60,
    zone: { start: ZONE, finish: ZONE },
    location: '',
    description: '',
    repeat: emptyRepeat(),
    reminder: -1,
    ...overrides,
  }
}

const at = (value: string) =>
  propertyInstant({ name: 'DTSTART', params: { TZID: [ZONE] }, value }, ZONE)!
    .seconds

const daily = { ...emptyRepeat(), frequency: 'daily' as const }

function stored(components: Component[], recurring: boolean) {
  return {
    event: {
      id: 'e1',
      calendar: 'cal1',
      etag: 'v1',
      recurring,
      components,
    },
  }
}

function occurrence(start: number, recurring: boolean): Instance {
  return {
    event: 'e1',
    calendar: 'cal1',
    colour: '#000',
    readonly: false,
    uid: 'u1',
    component: 'VEVENT',
    summary: 'Standup',
    location: '',
    description: '',
    status: '',
    start,
    finish: start + 3600,
    allday: false,
    recurring,
  }
}

/** The one undo the last success toast offered. */
const undo = () => {
  const calls = toasts.success.mock.calls
  const options = calls[calls.length - 1][1] as {
    action: { onClick: () => void }
  }
  options.action.onClick()
}

function mover() {
  const client = new QueryClient()
  return renderHook(() => useEventMove(), {
    wrapper: ({ children }) => (
      <I18nProvider i18n={i18n}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </I18nProvider>
    ),
  }).result
}

beforeEach(() => {
  for (const mock of [...Object.values(api), ...Object.values(toasts)]) {
    mock.mockReset()
  }
  api.update.mockImplementation((body: { event: string }) =>
    Promise.resolve({ event: { id: body.event, etag: 'v2', calendar: 'cal1' } })
  )
  api.create.mockResolvedValue({ event: { id: 'e2', etag: 'n1' } })
  api.delete.mockResolvedValue({})
  api.split.mockResolvedValue({
    event: { id: 'e1', etag: 'v2' },
    following: { id: 'e2', etag: 'n1' },
  })
})

describe('useEventMove', () => {
  it('moves a one-off event to a new time, and puts it back on Undo', async () => {
    const single = draftComponent(draft())
    api.get.mockResolvedValue(stored([single], false))
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260916T090000'), false),
        at('20260916T100000'),
        at('20260916T110000')
      )('all')
    )
    const written = api.update.mock.calls[0][0]
    expect(written.event).toBe('e1')
    expect(written.etag).toBe('v1')
    expect(propertyValue(written.components[0], 'DTSTART')).toBe(
      '20260916T100000'
    )
    expect(toasts.success).toHaveBeenCalledWith(
      'Event moved',
      expect.objectContaining({ action: expect.anything() })
    )
    await act(async () => {
      undo()
    })
    const restored = api.update.mock.calls[1][0]
    expect(restored.etag).toBe('v2')
    expect(restored.components).toEqual([single])
  })

  it('moves one occurrence of a series as an override', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260917T090000'), true),
        at('20260917T140000'),
        at('20260917T150000')
      )('one')
    )
    const written = api.update.mock.calls[0][0]
    expect(written.components).toHaveLength(2)
    expect(propertyValue(written.components[1], 'RECURRENCE-ID')).toBe(
      '20260917T090000'
    )
    expect(propertyValue(written.components[1], 'DTSTART')).toBe(
      '20260917T140000'
    )
  })

  it('cuts a series for "This and following", and reverses both halves on Undo', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260918T090000'), true),
        at('20260918T100000'),
        at('20260918T110000')
      )('following')
    )
    expect(api.update).not.toHaveBeenCalled()
    const split = api.split.mock.calls[0][0]
    expect(split.event).toBe('e1')
    expect(split.start).toBe(at('20260918T090000'))
    expect(propertyValue(split.components[0], 'RRULE')).toBe(
      'FREQ=DAILY;UNTIL=20260918T085959Z'
    )
    expect(propertyValue(split.following[0], 'DTSTART')).toBe('20260918T100000')
    expect(propertyValue(split.following[0], 'RRULE')).toBe('FREQ=DAILY')
    await act(async () => {
      undo()
    })
    expect(api.delete).toHaveBeenCalledWith('e2', 'n1')
    expect(api.update.mock.calls[0][0]).toMatchObject({
      event: 'e1',
      etag: 'v2',
      components: [series],
    })
  })

  it('shifts a whole series by as much as the occurrence moved, keeping its first day', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    // The third occurrence dragged an hour later: the series still begins
    // on the 16th, now at 10:00.
    await act(() =>
      current.toTime(
        occurrence(at('20260918T090000'), true),
        at('20260918T100000'),
        at('20260918T110000')
      )('all')
    )
    const written = api.update.mock.calls[0][0]
    expect(propertyValue(written.components[0], 'DTSTART')).toBe(
      '20260916T100000'
    )
    expect(propertyValue(written.components[0], 'DTEND')).toBe(
      '20260916T110000'
    )
  })

  it('treats "This and following" on the first occurrence as the whole series', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260916T090000'), true),
        at('20260916T100000'),
        at('20260916T110000')
      )('following')
    )
    expect(api.split).not.toHaveBeenCalled()
    const written = api.update.mock.calls[0][0]
    expect(propertyValue(written.components[0], 'DTSTART')).toBe(
      '20260916T100000'
    )
    expect(propertyValue(written.components[0], 'RRULE')).toBe('FREQ=DAILY')
  })

  it('copies rather than moves with the copy option, and deletes the copy on Undo', async () => {
    const single = draftComponent(draft())
    api.get.mockResolvedValue(stored([single], false))
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260916T090000'), false),
        at('20260917T090000'),
        at('20260917T100000'),
        { copy: true }
      )('all')
    )
    expect(api.update).not.toHaveBeenCalled()
    const created = api.create.mock.calls[0][0]
    expect(created.calendar).toBe('cal1')
    expect(propertyValue(created.components[0], 'DTSTART')).toBe(
      '20260917T090000'
    )
    expect(toasts.success).toHaveBeenCalledWith(
      'Event copied',
      expect.anything()
    )
    await act(async () => {
      undo()
    })
    expect(api.delete).toHaveBeenCalledWith('e2', 'n1')
  })

  it('copies one occurrence of a series as an event of its own', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    await act(() =>
      current.toDay(occurrence(at('20260917T090000'), true), '2026-09-25', {
        copy: true,
      })('one')
    )
    const created = api.create.mock.calls[0][0]
    expect(created.components).toHaveLength(1)
    expect(propertyValue(created.components[0], 'DTSTART')).toBe(
      '20260925T090000'
    )
    expect(propertyValue(created.components[0], 'RRULE')).toBe('')
    expect(propertyValue(created.components[0], 'RECURRENCE-ID')).toBe('')
  })

  it('moves a whole event to another calendar as it is', async () => {
    const single = draftComponent(draft())
    api.get.mockResolvedValue(stored([single], false))
    const { current } = mover()
    await act(() =>
      current.toCalendar(
        occurrence(at('20260916T090000'), false),
        'cal2'
      )('all')
    )
    const written = api.update.mock.calls[0][0]
    expect(written.calendar).toBe('cal2')
    expect(propertyValue(written.components[0], 'DTSTART')).toBe(
      '20260916T090000'
    )
    await act(async () => {
      undo()
    })
    expect(api.update.mock.calls[1][0].calendar).toBe('cal1')
  })

  it('moves one occurrence to another calendar by excluding it and creating it there', async () => {
    const series = draftComponent(draft({ repeat: daily }))
    api.get.mockResolvedValue(stored([series], true))
    const { current } = mover()
    await act(() =>
      current.toCalendar(occurrence(at('20260917T090000'), true), 'cal2')('one')
    )
    const created = api.create.mock.calls[0][0]
    expect(created.calendar).toBe('cal2')
    expect(propertyValue(created.components[0], 'DTSTART')).toBe(
      '20260917T090000'
    )
    expect(propertyValue(created.components[0], 'RECURRENCE-ID')).toBe('')
    const written = api.update.mock.calls[0][0]
    expect(written.components).toEqual(
      deletedOccurrence([series], at('20260917T090000'), ZONE)
    )
  })

  it('makes a timed event all-day on the day it landed on', async () => {
    const single = draftComponent(draft())
    api.get.mockResolvedValue(stored([single], false))
    const { current } = mover()
    await act(() =>
      current.toAllday(
        occurrence(at('20260916T090000'), false),
        '2026-09-18'
      )('all')
    )
    const written = api.update.mock.calls[0][0]
    expect(written.components[0].properties).toContainEqual({
      name: 'DTSTART',
      params: { VALUE: ['DATE'] },
      value: '20260918',
    })
    expect(propertyValue(written.components[0], 'DTEND')).toBe('20260919')
  })

  it('says the event changed elsewhere on a precondition failure', async () => {
    const single = draftComponent(draft())
    api.get.mockResolvedValue(stored([single], false))
    api.update.mockRejectedValue({ status: 412 })
    const { current } = mover()
    await act(() =>
      current.toTime(
        occurrence(at('20260916T090000'), false),
        at('20260916T100000'),
        at('20260916T110000')
      )('all')
    )
    expect(toasts.error).toHaveBeenCalledWith(
      'This event changed somewhere else.'
    )
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('keeps an "All events" move consistent with the editor helper', () => {
    // The hook writes through editedComponents; this pins the shape it relies on.
    const series = draftComponent(draft({ repeat: daily }))
    const moved = editedComponents(
      [series],
      draft({ startTime: 10 * 60, finishTime: 11 * 60, repeat: daily }),
      'all',
      at('20260917T090000'),
      ZONE
    )
    expect(propertyValue(moved[0], 'DTSTART')).toBe('20260916T100000')
  })
})
