// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Calendar } from '@/api/types/calendars'
import { RenameDialog } from './rename-dialog'

const calendar = { id: 'c1', name: 'Work' } as Calendar

const state = vi.hoisted(() => ({ rename: vi.fn(), pending: false }))

beforeEach(() => {
  state.rename = vi.fn().mockResolvedValue({})
  state.pending = false
})

vi.mock('@/hooks/use-calendars', () => ({
  useRenameCalendarMutation: () => ({
    mutateAsync: state.rename,
    isPending: state.pending,
  }),
}))

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <RenameDialog calendar={calendar} onClose={vi.fn()} />
    </I18nProvider>
  )
  return screen.getByLabelText('Name')
}

describe('RenameDialog', () => {
  it('sends nothing for Enter with the name emptied', () => {
    const name = show()
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(state.rename).not.toHaveBeenCalled()
  })

  it('sends nothing for Enter while a rename is under way', () => {
    state.pending = true
    const name = show()
    fireEvent.change(name, { target: { value: 'Home' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(state.rename).not.toHaveBeenCalled()
  })

  it('renames for Enter otherwise', () => {
    const name = show()
    fireEvent.change(name, { target: { value: 'Home' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(state.rename).toHaveBeenCalledWith({ calendar: 'c1', name: 'Home' })
  })
})
