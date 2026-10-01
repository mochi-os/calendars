// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Preferences } from '@/api/types/preferences'
import { DEFAULTS } from '@/hooks/use-preferences'
import { PreferencesDialog } from './preferences-dialog'

// The preferences as saved, and what a Save sends.
const state = vi.hoisted(() => ({
  preferences: {} as Preferences,
  save: vi.fn(),
}))

beforeEach(() => {
  state.preferences = { ...DEFAULTS }
  state.save.mockReset().mockResolvedValue({ preferences: state.preferences })
})

vi.mock('@/hooks/use-preferences', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/use-preferences')>()
  return {
    ...original,
    usePreferencesQuery: () => ({
      data: { preferences: state.preferences },
      isLoading: false,
      isError: false,
      error: null,
    }),
    useSetPreferencesMutation: () => ({
      mutateAsync: state.save,
      isPending: false,
    }),
  }
})
vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    ordered: [
      { id: 'c1', name: 'Home', colour: '#000', default: true, readonly: false },
      { id: 's1', name: 'Holidays', colour: '#000', readonly: true },
    ],
  }),
}))
vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return { ...original, toastAction: (promise: Promise<unknown>) => promise }
})

function show(open: boolean) {
  return (
    <I18nProvider i18n={i18n}>
      <PreferencesDialog open={open} onOpenChange={vi.fn()} />
    </I18nProvider>
  )
}

const zones = () =>
  screen.getByRole('switch', { name: 'Show events in their own time zone' })
const saveButton = () => screen.getByRole('button', { name: 'Save' })

describe('PreferencesDialog', () => {
  it('saves the calendar the picker shows once the chosen one has gone, so the save is not refused', async () => {
    state.preferences = { ...DEFAULTS, calendar: 'gone' }
    render(show(true))
    fireEvent.click(zones())
    fireEvent.click(saveButton())
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    expect(state.save.mock.calls[0][0]).toMatchObject({
      zones: true,
      calendar: 'c1',
    })
  })

  it('keeps a chosen calendar that is still there', async () => {
    state.preferences = { ...DEFAULTS, calendar: 'c1' }
    render(show(true))
    fireEvent.click(zones())
    fireEvent.click(saveButton())
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    expect(state.save.mock.calls[0][0].calendar).toBe('c1')
  })

  it('reopens on what is saved, not on edits a Cancel discarded', () => {
    const { rerender } = render(show(true))
    fireEvent.click(zones())
    expect(saveButton()).toBeEnabled()
    rerender(show(false))
    rerender(show(true))
    expect(zones()).not.toBeChecked()
    expect(saveButton()).toBeDisabled()
  })
})
