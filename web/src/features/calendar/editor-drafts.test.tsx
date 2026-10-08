// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from '@/api/types/events'
import { EventEditor } from './editor'

const { setEditing, noon, state } = vi.hoisted(() => ({
  setEditing: vi.fn(),
  noon: Date.UTC(2026, 8, 25, 12) / 1000,
  // What the editor is open on, and the stored event an edit reads; set
  // before rendering, so each stays one object for the render's life.
  state: {
    editing: null as unknown,
    event: undefined as unknown,
    create: vi.fn(),
    update: vi.fn(),
    split: vi.fn(),
  },
}))

type Block = (locations: {
  current: { pathname: string }
  next: { pathname: string }
}) => boolean

const away = {
  current: { pathname: '/' },
  next: { pathname: '/c1' },
}

const router = vi.hoisted(() => ({
  block: null as Block | null,
  blocked: false,
  proceed: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useBlocker: (options: { shouldBlockFn: Block }) => {
    router.block = options.shouldBlockFn
    return router.blocked
      ? { status: 'blocked', proceed: router.proceed, reset: router.reset }
      : { status: 'idle' }
  },
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
    get editing() {
      return state.editing ?? creating
    },
    setEditing,
    ordered: [{ id: 'c1', name: 'Personal', readonly: false, default: true }],
    remember: vi.fn(),
    reveal: vi.fn(),
  }
  return { useCalendarContext: () => context }
})

vi.mock('@/hooks/use-events', () => ({
  useEventQuery: () => ({
    data: state.event ? { event: state.event } : undefined,
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCreateEventMutation: () => ({
    mutateAsync: state.create,
    isPending: false,
  }),
  useUpdateEventMutation: () => ({
    mutateAsync: state.update,
    isPending: false,
  }),
  useSplitEventMutation: () => ({ mutateAsync: state.split, isPending: false }),
  useDeleteEventMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <EventEditor />
    </I18nProvider>
  )
}

const title = () => screen.getByLabelText('Title')
const close = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))

// Focus leaving a field for another place in the panel, the header's Close
// standing for it.
function leave(field: HTMLElement) {
  fireEvent.focusOut(field, {
    relatedTarget: screen.getByRole('button', { name: 'Close' }),
  })
}

function titleOf(components: Component[]) {
  return components[0].properties.find((p) => p.name === 'SUMMARY')?.value
}

// The stored event an edit opens on: a one-time Dentist, or a weekly series.
async function stored(recurring = false) {
  const { draftComponent, newDraft } =
    await vi.importActual<typeof import('@/lib/ical')>('@/lib/ical')
  const draft = newDraft(noon, noon + 3600, {
    allday: false,
    calendar: 'c1',
    reminder: -1,
    user: 'UTC',
    zone: { start: 'UTC', finish: 'UTC' },
  })
  const event = {
    id: 'e1',
    calendar: 'c1',
    etag: 'v1',
    recurring,
    summary: 'Dentist',
    updated: 1,
    components: [
      draftComponent({
        ...draft,
        title: 'Dentist',
        repeat: recurring
          ? { ...draft.repeat, frequency: 'weekly' as const }
          : draft.repeat,
      }),
    ],
  }
  state.event = event
  state.editing = { mode: 'edit', event: 'e1', start: noon }
  return event
}

beforeEach(() => {
  setEditing.mockClear()
  state.editing = null
  state.event = undefined
  state.create = vi.fn().mockResolvedValue({ event: { id: 'e9' } })
  state.update = vi.fn().mockImplementation(async (written) => ({
    event: { ...(state.event as object), ...written, etag: 'v2' },
  }))
  state.split = vi
    .fn()
    .mockResolvedValue({ event: { id: 'e1' }, following: { id: 'e7' } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EventEditor making an event', () => {
  it('opens in a side panel with Create, and no Copy or Delete', () => {
    show()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New event' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('saves nothing while it is typed into', () => {
    vi.useFakeTimers()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    leave(title())
    act(() => vi.advanceTimersByTime(2000))
    expect(state.create).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('creates the event with Create, then goes on as its editor', async () => {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(setEditing).toHaveBeenCalledWith({
        mode: 'edit',
        event: 'e9',
        start: noon,
      })
    )
    const request = state.create.mock.calls[0][0] as {
      calendar: string
      components: Component[]
    }
    expect(request.calendar).toBe('c1')
    expect(titleOf(request.components)).toBe('Dentist')
  })

  it('creates on Enter in the title, refusing one with no title and saying so', () => {
    show()
    expect(screen.queryByTestId('untitled')).toBeNull()
    fireEvent.keyDown(title(), { key: 'Enter' })
    expect(screen.getByTestId('untitled')).toBeInTheDocument()
    expect(state.create).not.toHaveBeenCalled()
  })

  it('does not create on the Enter that ends an IME composition', () => {
    show()
    fireEvent.keyDown(title(), { key: 'Enter', isComposing: true })
    expect(screen.queryByTestId('untitled')).toBeNull()
  })

  it('closes untouched at once', () => {
    show()
    close()
    expect(setEditing).toHaveBeenCalledWith(null)
    expect(screen.queryByText('Discard draft?')).toBeNull()
  })

  it('asks before closing drops what was typed', () => {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    close()
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(setEditing).toHaveBeenCalledWith(null)
  })

  it('asks before Escape drops what was typed', () => {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    fireEvent.keyDown(title(), { key: 'Escape' })
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
  })

  it('asks before a click outside drops what was typed', async () => {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    // The panel listens for a press outside only once it has opened.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.mouseUp(document.body)
    fireEvent.click(document.body)
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
  })

  it('shows event colour and URL fields', () => {
    show()
    expect(screen.getByText('Colour')).toBeInTheDocument()
    expect(screen.getByLabelText('URL')).toBeInTheDocument()
  })
})

describe('EventEditor leaving', () => {
  beforeEach(() => {
    router.block = null
    router.proceed.mockReset()
    router.reset.mockReset()
  })

  afterEach(() => {
    router.blocked = false
  })

  // Something typed into a new event, then a navigation the blocker holds:
  // the question opens over the panel, as it does when a link is followed.
  function hold() {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    router.blocked = true
    fireEvent.change(title(), { target: { value: 'Dentist at noon' } })
  }

  it('lets a link away through while a new event is untouched', () => {
    show()
    expect(router.block!(away)).toBe(false)
  })

  it('holds a link away while a new event holds something typed', () => {
    show()
    fireEvent.change(title(), { target: { value: 'Dentist' } })
    expect(router.block!(away)).toBe(true)
    fireEvent.change(title(), { target: { value: '' } })
    expect(router.block!(away)).toBe(false)
  })

  it('asks the question closing asks, and discards and leaves on Discard', () => {
    hold()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
    expect(screen.getByText('Your changes will be lost.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(router.proceed).toHaveBeenCalledTimes(1)
    expect(setEditing).toHaveBeenCalledWith(null)
  })

  it('stays, with the panel open, when the question is dismissed', () => {
    hold()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(router.reset).toHaveBeenCalledTimes(1)
    expect(router.proceed).not.toHaveBeenCalled()
    expect(setEditing).not.toHaveBeenCalled()
  })

  it('lets a link away through from a one-time event, which saves itself', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    expect(router.block!(away)).toBe(false)
  })
})

describe('EventEditor saving a one-time event', () => {
  it('opens titled with the event, Copy and Delete in its header', async () => {
    await stored()
    show()
    expect(screen.getByRole('heading', { name: 'Dentist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
  })

  it('saves once typing rests for a second, against the etag it read', async () => {
    vi.useFakeTimers()
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    act(() => vi.advanceTimersByTime(900))
    expect(state.update).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(100))
    expect(state.update).toHaveBeenCalledTimes(1)
    const request = state.update.mock.calls[0][0] as {
      event: string
      etag: string
      components: Component[]
    }
    expect(request).toMatchObject({ event: 'e1', etag: 'v1' })
    expect(titleOf(request.components)).toBe('Dentist, moved')
  })

  it('saves a field when it is left for another place in the panel', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    leave(title())
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
  })

  it("does not save when focus goes into a field's picker outside the panel", async () => {
    await stored()
    show()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    fireEvent.focusOut(title(), { relatedTarget: outside })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(state.update).not.toHaveBeenCalled()
    outside.remove()
  })

  it('saves the next change against the etag the last save came back with', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    leave(title())
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
    fireEvent.change(title(), { target: { value: 'Dentist, moved again' } })
    leave(title())
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(2))
    expect(state.update.mock.calls[1][0]).toMatchObject({ etag: 'v2' })
  })

  it('saves what was typed on closing, then closes', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    close()
    await waitFor(() => expect(setEditing).toHaveBeenCalledWith(null))
    expect(state.update).toHaveBeenCalledTimes(1)
  })

  it('writes nothing more over an event changed elsewhere until it is read again', async () => {
    await stored()
    state.update = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('changed'), { status: 412 }))
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    leave(title())
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
    fireEvent.change(title(), { target: { value: 'Dentist, moved again' } })
    leave(title())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(state.update).toHaveBeenCalledTimes(1)
  })

  it('closes untouched without saving', async () => {
    await stored()
    show()
    close()
    expect(setEditing).toHaveBeenCalledWith(null)
    expect(state.update).not.toHaveBeenCalled()
  })

  it('saves nothing without a title, says so, and asks before closing drops it', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: ' ' } })
    leave(title())
    expect(screen.getByTestId('untitled')).toBeInTheDocument()
    close()
    expect(screen.getByText('Discard draft?')).toBeInTheDocument()
    expect(state.update).not.toHaveBeenCalled()
  })

  it('shows an existing named event colour', async () => {
    const event = await stored()
    event.components[0].properties.push({
      name: 'COLOR',
      params: {},
      value: 'Turquoise',
    })
    show()
    expect(screen.getByRole('textbox', { name: 'Colour value' })).toHaveValue(
      'Turquoise'
    )
  })
})

describe('EventEditor saving a series', () => {
  it('saves nothing as it is typed, and asks which occurrences when the field is left', async () => {
    vi.useFakeTimers()
    await stored(true)
    show()
    fireEvent.change(title(), { target: { value: 'Standup' } })
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
    vi.useRealTimers()
    leave(title())
    fireEvent.click(await screen.findByRole('button', { name: 'All events' }))
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1))
    expect(setEditing).not.toHaveBeenCalled()
  })

  it('asks on closing, saves, and then closes', async () => {
    await stored(true)
    show()
    fireEvent.change(title(), { target: { value: 'Standup' } })
    close()
    fireEvent.click(await screen.findByRole('button', { name: 'All events' }))
    await waitFor(() => expect(setEditing).toHaveBeenCalledWith(null))
    expect(state.update).toHaveBeenCalledTimes(1)
  })

  it('stays open with the change when the question is dismissed', async () => {
    await stored(true)
    show()
    fireEvent.change(title(), { target: { value: 'Standup' } })
    close()
    await screen.findByRole('button', { name: 'All events' })
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'All events' })).toBeNull()
    )
    expect(setEditing).not.toHaveBeenCalled()
    expect(title()).toHaveValue('Standup')
  })

  it('goes on as the new series a change to this and the following occurrences makes', async () => {
    await stored(true)
    // The second occurrence: the first has nothing before it to keep.
    const week = noon + 7 * 86400
    state.editing = { mode: 'edit', event: 'e1', start: week }
    show()
    fireEvent.change(title(), { target: { value: 'Standup' } })
    leave(title())
    fireEvent.click(
      await screen.findByRole('button', { name: /following/i })
    )
    await waitFor(() =>
      expect(setEditing).toHaveBeenCalledWith({
        mode: 'edit',
        event: 'e7',
        start: week,
      })
    )
    expect(state.split).toHaveBeenCalledTimes(1)
  })
})

describe('EventEditor copying', () => {
  it('copies the stored event at once and opens the copy', async () => {
    await stored()
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(setEditing).toHaveBeenCalledWith({
        mode: 'edit',
        event: 'e9',
        start: noon,
      })
    )
    const request = state.create.mock.calls[0][0] as {
      components: Component[]
    }
    expect(titleOf(request.components)).toBe('Dentist')
  })

  it('carries a change not yet saved into the copy', async () => {
    await stored()
    show()
    fireEvent.change(title(), { target: { value: 'Dentist, moved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1))
    const request = state.create.mock.calls[0][0] as {
      components: Component[]
    }
    expect(titleOf(request.components)).toBe('Dentist, moved')
  })
})

describe('EventEditor making an event from a series', () => {
  async function drafting(repeat: object) {
    const { newDraft } =
      await vi.importActual<typeof import('@/lib/ical')>('@/lib/ical')
    const draft = newDraft(noon, noon + 3600, {
      allday: false,
      calendar: 'c1',
      reminder: -1,
      user: 'UTC',
      zone: { start: 'UTC', finish: 'UTC' },
    })
    state.editing = {
      mode: 'create',
      draft: { ...draft, repeat: { ...draft.repeat, ...repeat } },
    }
  }

  it('shows a custom series in the custom panel, as an edit of it does', async () => {
    await drafting({
      frequency: 'weekly',
      interval: 2,
      weekdays: [1, 4],
      ending: 'count',
      count: 7,
    })
    show()
    expect(screen.getByLabelText('Every')).toHaveValue(2)
    expect(screen.getByLabelText('Occurrences')).toHaveValue(7)
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-pressed') === 'true')
    ).toHaveLength(2)
  })

  it('keeps a plain series on its plain choice', async () => {
    await drafting({ frequency: 'weekly' })
    show()
    expect(screen.queryByLabelText('Every')).toBeNull()
  })
})
