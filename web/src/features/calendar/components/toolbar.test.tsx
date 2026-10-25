// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Toolbar } from './toolbar'

const context = {
  view: 'month',
  setView: vi.fn(),
  date: '2026-09-22',
  setDate: vi.fn(),
  listed: undefined as string | undefined,
  today: '2026-09-22',
  range: { from: '2026-08-31', days: 42, date: '2026-09-22' },
  workweek: false,
  setWorkweek: vi.fn(),
  search: '',
  setSearch: vi.fn(),
}

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => context,
}))

const { size } = vi.hoisted(() => ({
  size: { isDesktop: true, isMobile: false },
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return { ...original, useScreenSize: () => size }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  size.isDesktop = true
  size.isMobile = false
  context.listed = undefined
  context.search = ''
})

// The toolbar in a view, with its search field opened where it starts as an
// icon.
function show(view: string) {
  draw(view)
  const icon = screen.queryByRole('button', { name: 'Search' })
  if (icon) fireEvent.click(icon)
  return screen.getByRole('searchbox', { name: 'Search' })
}

function draw(view: string) {
  context.view = view
  render(
    <I18nProvider i18n={i18n}>
      <Toolbar onCreate={vi.fn()} />
    </I18nProvider>
  )
}

// Opens the view menu.
function menu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: /^View/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })
}

// The views the menu offers.
function views() {
  menu()
  return screen
    .getAllByRole('menuitemradio')
    .map((option) => option.textContent)
}

describe('Toolbar views', () => {
  it('offers every view on a tablet', () => {
    size.isDesktop = false
    show('day')
    expect(views()).toEqual(['Day', 'Week', 'Multiweek', 'Month', 'List'])
  })

  it('offers only the day and the list on a phone', () => {
    size.isDesktop = false
    size.isMobile = true
    show('day')
    expect(views()).toEqual(['Day', 'List'])
  })
})

describe('Toolbar new event', () => {
  it('is a plain plus with no words and no fill, on a wide screen and a phone', () => {
    for (const mobile of [false, true]) {
      size.isDesktop = !mobile
      size.isMobile = mobile
      show('month')
      const create = screen.getByRole('button', { name: 'New event' })
      expect(create.textContent).toBe('')
      expect(create.querySelector('svg')).not.toBeNull()
      expect(create.classList.contains('bg-primary')).toBe(false)
      cleanup()
    }
  })
})

describe('Toolbar arrangement', () => {
  it('keeps where you are on the left, and new, search and the view together on the right', () => {
    draw('month')
    const order = screen
      .getAllByRole('button')
      .map(
        (button) =>
          button.getAttribute('aria-label') ?? button.textContent?.trim()
      )
    expect(order).toEqual([
      'Previous',
      'Today',
      'Next',
      'September 2026',
      'New event',
      'Search',
      'ViewMonth',
    ])
    const actions = screen.getByRole('button', {
      name: 'New event',
    }).parentElement!
    expect(
      actions.contains(screen.getByRole('button', { name: 'Search' }))
    ).toBe(true)
    expect(actions.contains(screen.getByRole('heading'))).toBe(false)
  })

  it('names the current view in the menu button, with its icon', () => {
    draw('week')
    const button = screen.getByRole('button', { name: /^View/ })
    expect(button.textContent).toBe('ViewWeek')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('opens a month to pick a day from the title on a wide screen too', () => {
    draw('month')
    fireEvent.click(screen.getByRole('button', { name: 'September 2026' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offers the work week inside the view menu in the week view, and nowhere else', () => {
    draw('week')
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull()
    menu()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Work week' }))
    expect(context.setWorkweek).toHaveBeenCalledWith(true)
    cleanup()
    draw('month')
    menu()
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })

  it('switches the view from the menu', () => {
    draw('month')
    menu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Week' }))
    expect(context.setView).toHaveBeenCalledWith('week')
  })
})

describe('Toolbar search icon', () => {
  it('starts as an icon on a wide screen and opens into the focused field', () => {
    draw('month')
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const field = screen.getByRole('searchbox', { name: 'Search' })
    expect(document.activeElement).toBe(field)
  })

  it('closes again when left empty', () => {
    draw('month')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.blur(screen.getByRole('searchbox'))
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('stays open while it holds a term', () => {
    context.search = 'flight'
    draw('list')
    const field = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.blur(field)
    expect(screen.getByRole('searchbox')).toBe(field)
  })

  it('clears and closes on Escape, giving focus back to the icon', () => {
    draw('month')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' })
    expect(context.setSearch).toHaveBeenCalledWith('')
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Search' })
    )
  })

  it('is always the field on a phone', () => {
    size.isDesktop = false
    size.isMobile = true
    draw('list')
    expect(
      screen.getByRole('searchbox', { name: 'Search' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })
})

describe('Toolbar search', () => {
  it('fits a phone in two rows: the arrows and title, then search, view and new', () => {
    size.isDesktop = false
    size.isMobile = true
    const onCreate = vi.fn()
    context.view = 'list'
    render(
      <I18nProvider i18n={i18n}>
        <Toolbar onCreate={onCreate} />
      </I18nProvider>
    )
    const previous = screen.getByRole('button', { name: 'Previous' })
    const title = screen.getByRole('button', { name: /2026/ })
    const create = screen.getByRole('button', { name: 'New event' })
    const search = screen.getByRole('searchbox', { name: 'Search' })
    const first = previous.parentElement!.parentElement!
    expect(first.contains(title)).toBe(true)
    expect(first.contains(search)).toBe(false)
    expect(create.parentElement!.contains(search)).toBe(true)
    fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('sets the term and opens the list view when typed from another view', () => {
    fireEvent.change(show('month'), { target: { value: 'flight' } })
    expect(context.setSearch).toHaveBeenCalledWith('flight')
    expect(context.setView).toHaveBeenCalledWith('list')
  })

  it('keeps the list view where it is', () => {
    fireEvent.change(show('list'), { target: { value: 'flight' } })
    expect(context.setSearch).toHaveBeenCalledWith('flight')
    expect(context.setView).not.toHaveBeenCalled()
  })

  it('does not leave a view for blank text', () => {
    fireEvent.change(show('week'), { target: { value: '   ' } })
    expect(context.setSearch).toHaveBeenCalledWith('   ')
    expect(context.setView).not.toHaveBeenCalled()
  })
})

describe('Toolbar navigation', () => {
  it('puts Today between the previous and next arrows, and jumps to today', () => {
    show('month')
    const names = screen
      .getAllByRole('button')
      .map(
        (button) =>
          button.getAttribute('aria-label') ?? button.textContent?.trim()
      )
      .filter((name) => ['Previous', 'Today', 'Next'].includes(name ?? ''))
    expect(names).toEqual(['Previous', 'Today', 'Next'])
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(context.setDate).toHaveBeenCalledWith('2026-09-22')
  })
})

describe('Toolbar heading', () => {
  const heading = () => screen.getByRole('heading').textContent

  it("writes a day in the user's date format", () => {
    context.range = { from: '2026-09-22', days: 1, date: '2026-09-22' }
    show('day')
    expect(heading()).toBe('2026-09-22')
  })

  it("writes a week or a multiweek span as its first and last dates in the user's date format, joined by an en dash", () => {
    context.range = { from: '2026-09-21', days: 7, date: '2026-09-22' }
    show('week')
    expect(heading()).toBe('2026-09-21 – 2026-09-27')
    cleanup()
    context.range = { from: '2026-09-21', days: 28, date: '2026-09-22' }
    show('multiweek')
    expect(heading()).toBe('2026-09-21 – 2026-10-18')
  })

  // The size and weight classes an element's text is set in.
  const type = (element: HTMLElement) =>
    element.className
      .split(/\s+/)
      .filter((name) => /^text-(xs|sm|base|lg|xl)$|^font-/.test(name))
      .sort()

  it("sets the heading in the Today button's size and weight, on wide and narrow screens", () => {
    show('week')
    const today = type(screen.getByRole('button', { name: 'Today' }))
    expect(today).toEqual(['font-medium', 'text-sm'])
    expect(type(screen.getByRole('heading'))).toEqual(today)
    cleanup()
    size.isDesktop = false
    show('week')
    const title = screen.getByRole('button', { name: /2026-09-21/ })
    expect(type(title)).toEqual(today)
  })

  it('names the month in the month view', () => {
    context.range = { from: '2026-08-31', days: 42, date: '2026-09-22' }
    show('month')
    expect(heading()).toMatch(/September 2026/)
  })

  it('names the month the list has scrolled to, and steps a month from it', () => {
    context.range = { from: '2026-09-22', days: 1, date: '2026-09-22' }
    context.listed = '2026-10-03'
    show('list')
    expect(heading()).toMatch(/October 2026/)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(context.setDate).toHaveBeenLastCalledWith('2026-11-01')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(context.setDate).toHaveBeenLastCalledWith('2026-09-01')
  })

  it("names the anchored day's month until the list says what is atop it", () => {
    context.range = { from: '2026-09-22', days: 1, date: '2026-09-22' }
    show('list')
    expect(heading()).toMatch(/September 2026/)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(context.setDate).toHaveBeenLastCalledWith('2026-10-01')
  })

})
