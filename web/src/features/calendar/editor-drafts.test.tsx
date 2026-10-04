// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEditor } from './editor'

const { setEditing, noon, state } = vi.hoisted(() => ({
  setEditing: vi.fn(),
  noon: Date.UTC(2026, 8, 25, 12) / 1000,
  // What the editor is open on, and the stored event an edit reads; set
  // before rendering, so each stays one object for the render's life.
  state: {
    editing: null as unknown,
    event: undefined as unknown,
    mobile: false,
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

// The router's blocker as the editor registers it.
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

// The phone layout on demand; every other test keeps the real width.
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    useScreenSize: () => {
      const real = original.useScreenSize()
      return state.mobile ? { ...real, isMobile: true, isDesktop: false } : real
    },
  }
})

// Built once: the editor re-reads its draft whenever `editing` changes, so a
// fresh object on every render would never settle.
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

vi.mock('@/hooks/use-events', () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    useEventQuery: () => ({
      data: state.event ? { event: state.event } : undefined,
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

  it('does nothing on a click outside, even with a change', async () => {
    show()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Dentist' },
    })
    // The dialog listens for a press outside only once it has opened.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    fireEvent.pointerUp(document.body)
    fireEvent.mouseUp(document.body)
    fireEvent.click(document.body)
    expect(setEditing).not.toHaveBeenCalled()
    expect(screen.queryByText('Discard draft?')).toBeNull()
    expect(screen.getByLabelText('Title')).toHaveValue('Dentist')
  })
})

describe('EventEditor leaving', () => {
  beforeEach(() => {
    setEditing.mockClear()
    router.block = null
    router.proceed.mockReset()
    router.reset.mockReset()
  })

  afterEach(() => {
    router.blocked = false
  })

  // A change, then a navigation the blocker holds: the question opens over the
  // editor, as it does when a link is followed with the editor open.
  function hold() {
    show()
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Dentist' } })
    router.blocked = true
    fireEvent.change(title, { target: { value: 'Dentist at noon' } })
  }

  it('lets a link away through while the form is untouched', () => {
    show()
    expect(router.block!(away)).toBe(false)
  })

  it('holds a link away while the form holds a change', () => {
    show()
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Dentist' } })
    expect(router.block!(away)).toBe(true)
    fireEvent.change(title, { target: { value: '' } })
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

  it('stays, with the form open, when the question is dismissed', () => {
    hold()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(router.reset).toHaveBeenCalledTimes(1)
    expect(router.proceed).not.toHaveBeenCalled()
    expect(setEditing).not.toHaveBeenCalled()
  })
})

describe('EventEditor saving', () => {
  it('shows event colour and URL fields', () => {
    show()
    expect(screen.getByText('Colour')).toBeInTheDocument()
    expect(screen.getByLabelText('URL')).toBeInTheDocument()
  })

  it('saves on Enter in the title, as the Save button does', () => {
    show()
    expect(screen.queryByTestId('untitled')).toBeNull()
    // An empty title is the save's own refusal, so it proves Enter reached it.
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' })
    expect(screen.getByTestId('untitled')).toBeInTheDocument()
  })

  it('does not save on the Enter that ends an IME composition', () => {
    show()
    fireEvent.keyDown(screen.getByLabelText('Title'), {
      key: 'Enter',
      isComposing: true,
    })
    expect(screen.queryByTestId('untitled')).toBeNull()
  })
})

describe('EventEditor on a phone', () => {
  afterEach(() => {
    state.mobile = false
  })

  it('leaves Cancel to the header X', () => {
    state.mobile = true
    show()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})

describe('EventEditor copying', () => {
  beforeEach(async () => {
    setEditing.mockClear()
    const { draftComponent, newDraft } =
      await vi.importActual<typeof import('@/lib/ical')>('@/lib/ical')
    const stored = newDraft(noon, noon + 3600, {
      allday: false,
      calendar: 'c1',
      reminder: -1,
      user: 'UTC',
      zone: { start: 'UTC', finish: 'UTC' },
    })
    state.event = {
      id: 'e1',
      calendar: 'c1',
      etag: 'v1',
      recurring: false,
      components: [draftComponent({ ...stored, title: 'Dentist' })],
    }
    state.editing = { mode: 'edit', event: 'e1', start: noon }
  })

  afterEach(() => {
    state.editing = null
    state.event = undefined
  })

  it('carries edits not yet saved into the copy, and still guards them', () => {
    show()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Dentist, moved' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const next = setEditing.mock.lastCall?.[0] as {
      draft: { title: string }
      initial: { title: string }
    }
    expect(next.draft.title).toBe('Dentist, moved')
    expect(next.initial.title).toBe('Dentist')
  })

  it('shows an existing named event colour for editing', () => {
    const stored = state.event as {
      components: {
        properties: { name: string; params: object; value: string }[]
      }[]
    }
    stored.components[0].properties.push({
      name: 'COLOR',
      params: {},
      value: 'Turquoise',
    })
    show()
    expect(screen.getByRole('textbox', { name: 'Colour value' })).toHaveValue(
      'Turquoise'
    )
  })

  it('copies the stored event when nothing was changed', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const next = setEditing.mock.lastCall?.[0] as {
      draft: { title: string }
    }
    expect(next.draft.title).toBe('Dentist')
  })
})

describe('EventEditor opening a copy', () => {
  async function copying(repeat: object) {
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
      copy: true,
      draft: { ...draft, repeat: { ...draft.repeat, ...repeat } },
    }
  }

  afterEach(() => {
    state.editing = null
  })

  it('shows a custom series in the custom panel, as an edit of it does', async () => {
    await copying({
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
    await copying({ frequency: 'weekly' })
    show()
    expect(screen.queryByLabelText('Every')).toBeNull()
  })
})
