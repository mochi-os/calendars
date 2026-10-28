// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Calendar } from '@/api/types/calendars'
import { CalendarSettings, type CalendarTab } from './settings'

// Publish to is a tab of its own on one of the user's own calendars with
// somewhere to publish; with nowhere, the page has no tabs.

const state = vi.hoisted(() => ({
  calendar: {} as Calendar,
  publish: vi.fn(),
}))

vi.mock('@/api/calendars', () => ({
  calendarsApi: {
    get: () => Promise.resolve({ calendar: state.calendar }),
    publish: state.publish,
  },
}))

vi.mock('@/hooks/use-calendars', () => ({
  useRenameCalendarMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useColourCalendarMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/use-ics-copy', () => ({
  useIcsCopy: () => ({ copy: vi.fn(), revoke: vi.fn() }),
}))

const own: Calendar = {
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

const account = {
  id: 'm1',
  type: 'mastodon',
  identifier: '@alice@mastodon.social',
  name: 'Alice',
}

function show(tab?: CalendarTab, onTab = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider i18n={i18n}>
        <CalendarSettings fingerprint='abcdefghi' tab={tab} onTab={onTab} />
      </I18nProvider>
    </QueryClientProvider>
  )
  return onTab
}

describe('calendar settings tabs', () => {
  beforeEach(() => {
    i18n.load('en', {})
    i18n.activate('en')
    state.calendar = own
    state.publish.mockReset()
  })

  it('offers Publish to after Settings where the calendar has somewhere to publish, and holds the section', async () => {
    state.publish.mockResolvedValue({
      accounts: [account],
      publish: [],
      copies: {},
    })
    show()
    expect(await screen.findByRole('tab', { name: 'Publish to' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Settings',
      'Publish to',
    ])
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.queryByText('@alice@mastodon.social')).toBeNull()
  })

  it('shows the section on its tab, without the settings', async () => {
    state.publish.mockResolvedValue({
      accounts: [account],
      publish: [],
      copies: {},
    })
    show('publish')
    expect(await screen.findByText('@alice@mastodon.social')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('has no tabs where there is nowhere to publish, and a link to Publish to opens the settings', async () => {
    state.publish.mockResolvedValue({ accounts: [], publish: [], copies: {} })
    show('publish')
    await waitFor(() => expect(state.publish).toHaveBeenCalled())
    expect(await screen.findByLabelText('Name')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull())
  })

  it('holds a link to Publish to while that is asked', async () => {
    state.publish.mockReturnValue(new Promise(() => {}))
    show('publish')
    await waitFor(() => expect(state.publish).toHaveBeenCalled())
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe(
      'Publish to'
    )
  })

  it('has no tabs on a subscribed calendar, which is never asked', async () => {
    state.calendar = {
      ...own,
      kind: 'subscription',
      url: 'https://x.example/a.ics',
    }
    show()
    expect(await screen.findByLabelText('Name')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(state.publish).not.toHaveBeenCalled()
  })
})
