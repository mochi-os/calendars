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
})

function show(view: string) {
  context.view = view
  render(
    <I18nProvider i18n={i18n}>
      <Toolbar onCreate={vi.fn()} />
    </I18nProvider>
  )
  return screen.getByRole('searchbox', { name: 'Search' })
}

// The views the picker offers, read from its open list.
function views() {
  fireEvent.pointerDown(screen.getByRole('combobox', { name: 'View' }), {
    button: 0,
    pointerType: 'mouse',
  })
  return screen.getAllByRole('option').map((option) => option.textContent)
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
