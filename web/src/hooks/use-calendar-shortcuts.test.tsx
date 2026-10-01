// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarShortcuts } from './use-calendar-shortcuts'

const actions = {
  today: vi.fn(),
  page: vi.fn(),
  create: vi.fn(),
  view: vi.fn(),
  search: vi.fn(),
}

function Harness({ blocked = false }: { blocked?: boolean }) {
  useCalendarShortcuts({ blocked, ...actions })
  return (
    <>
      <input aria-label='Typing' />
      <button type='button'>Today</button>
      <div role='radiogroup'>
        <button type='button' role='radio' aria-checked>
          Week
        </button>
      </div>
    </>
  )
}

describe('calendar shortcuts', () => {
  beforeEach(() => {
    Object.values(actions).forEach((action) => action.mockClear())
  })

  afterEach(() => {
    document.documentElement.dir = ''
  })

  it('maps T, N, the view keys and / to their actions', () => {
    render(<Harness />)
    for (const key of ['t', 'n', 'd', 'w', 'm', 'l', '/'])
      fireEvent.keyDown(window, { key })
    expect(actions.today).toHaveBeenCalledTimes(1)
    expect(actions.create).toHaveBeenCalledTimes(1)
    expect(actions.search).toHaveBeenCalledTimes(1)
    expect(actions.view.mock.calls.map(([view]) => view)).toEqual([
      'day',
      'week',
      'month',
      'list',
    ])
  })

  it('pages with the arrows', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(actions.page.mock.calls).toEqual([[-1], [1]])
  })

  it('pages the other way in a right-to-left language', () => {
    document.documentElement.dir = 'rtl'
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(actions.page).toHaveBeenCalledWith(1)
  })

  it('still works after a button was clicked and kept focus', () => {
    const { getByRole } = render(<Harness />)
    const button = getByRole('button', { name: 'Today' })
    button.focus()
    fireEvent.keyDown(button, { key: 'n' })
    fireEvent.keyDown(button, { key: 'ArrowRight' })
    expect(actions.create).toHaveBeenCalledTimes(1)
    expect(actions.page).toHaveBeenCalledWith(1)
  })

  it('leaves the arrows to a widget that moves its own focus', () => {
    const { getByRole } = render(<Harness />)
    fireEvent.keyDown(getByRole('radio', { name: 'Week' }), {
      key: 'ArrowRight',
    })
    expect(actions.page).not.toHaveBeenCalled()
  })

  it('ignores keys typed into a field', () => {
    const { getByRole } = render(<Harness />)
    fireEvent.keyDown(getByRole('textbox'), { key: 'n' })
    fireEvent.keyDown(getByRole('textbox'), { key: 'ArrowLeft' })
    expect(actions.create).not.toHaveBeenCalled()
    expect(actions.page).not.toHaveBeenCalled()
  })

  it('takes / with Shift, which some layouts need, but not a Shift letter', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: '/', shiftKey: true })
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    expect(actions.search).toHaveBeenCalledTimes(1)
    expect(actions.create).not.toHaveBeenCalled()
  })

  it('does nothing while blocked, with a modifier, or under a dialog', () => {
    const { rerender } = render(<Harness blocked />)
    fireEvent.keyDown(window, { key: 'n' })
    rerender(<Harness />)
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(window, { key: 'n' })
    dialog.remove()
    expect(actions.create).not.toHaveBeenCalled()
  })
})
