// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScopeDialog } from './scope-dialog'

function show(recurring: boolean) {
  const onChoose = vi.fn()
  render(
    <I18nProvider i18n={i18n}>
      <ScopeDialog
        open
        title='Move this event'
        recurring={recurring}
        onOpenChange={vi.fn()}
        onChoose={onChoose}
      />
    </I18nProvider>
  )
  return onChoose
}

describe('ScopeDialog', () => {
  it('offers this occurrence, this and following, and all, for a series', () => {
    const onChoose = show(true)
    fireEvent.click(screen.getByRole('button', { name: 'This event' }))
    expect(onChoose).toHaveBeenLastCalledWith('one')
    fireEvent.click(screen.getByRole('button', { name: 'This and following' }))
    expect(onChoose).toHaveBeenLastCalledWith('following')
    fireEvent.click(screen.getByRole('button', { name: 'All events' }))
    expect(onChoose).toHaveBeenLastCalledWith('all')
  })

  it('offers a plain confirm for an event that does not repeat', () => {
    const onChoose = show(false)
    expect(
      screen.queryByRole('button', { name: 'This and following' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onChoose).toHaveBeenCalledWith('all')
  })
})
