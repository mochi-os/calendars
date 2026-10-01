// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Calendar } from '@/api/types/calendars'
import { RenameDialog } from './dialogs/rename-dialog'
import { CalendarSettings } from './settings'

// The server refuses a calendar name past 100 characters, so every field that
// names a calendar stops there rather than letting the save fail.

const calendar: Calendar = {
  id: 'c1',
  fingerprint: 'abcdefghi',
  slug: 'work',
  name: 'Work',
  colour: '#4ade80',
  kind: 'own',
  url: '',
  account: '',
  collection: '',
  readonly: false,
  default: false,
  version: 1,
  fetched: 0,
  failure: '',
  created: 1,
  updated: 1,
}

vi.mock('@/api/calendars', () => ({
  calendarsApi: { get: () => Promise.resolve({ calendar }) },
}))

vi.mock('@/hooks/use-calendars', () => ({
  useRenameCalendarMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useColourCalendarMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-ics-copy', () => ({
  useIcsCopy: () => ({ copy: vi.fn(), revoke: vi.fn() }),
}))

function wrap(children: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </QueryClientProvider>
  )
}

describe('calendar name limits', () => {
  it('stops the rename dialog at 100 characters', () => {
    render(wrap(<RenameDialog calendar={calendar} onClose={vi.fn()} />))
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '100')
  })

  it("stops the calendar's own page at 100 characters", async () => {
    render(wrap(<CalendarSettings fingerprint='abcdefghi' />))
    expect(await screen.findByLabelText('Name')).toHaveAttribute(
      'maxlength',
      '100'
    )
  })
})
