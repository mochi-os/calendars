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

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return { ...original, useScreenSize: () => ({ isDesktop: true }) }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

describe('Toolbar search', () => {
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
      .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())
      .filter((name) => ['Previous', 'Today', 'Next'].includes(name ?? ''))
    expect(names).toEqual(['Previous', 'Today', 'Next'])
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(context.setDate).toHaveBeenCalledWith('2026-09-22')
  })
})
