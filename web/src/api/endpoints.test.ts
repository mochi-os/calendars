// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
// The table holds class-level actions only: every id goes in the body or the
// query, never the path. The actions are addressed under the app's own path,
// or relative to it under domain routing, where there is none.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ app: '/calendars' }))

vi.mock('@mochi/web', () => ({ getAppPath: () => state.app }))

async function table() {
  vi.resetModules()
  return (await import('./endpoints')).default
}

describe('calendar endpoints', () => {
  beforeEach(() => {
    state.app = '/calendars'
  })

  it("addresses each action under the app's path", async () => {
    const endpoints = await table()
    expect(endpoints.calendars.list).toBe('/calendars/-/calendars')
    expect(endpoints.calendars.publishSet).toBe(
      '/calendars/-/calendars/publish/set'
    )
    expect(endpoints.events.delete).toBe('/calendars/-/events/delete')
    expect(endpoints.link.revoke).toBe('/calendars/-/link/revoke')
    expect(endpoints.tokens.list).toBe('/calendars/-/token/list')
  })

  it('addresses each action relatively under domain routing', async () => {
    state.app = ''
    const endpoints = await table()
    expect(endpoints.calendars.list).toBe('-/calendars')
    expect(endpoints.events.bounds).toBe('-/events/bounds')
    expect(endpoints.preferences.set).toBe('-/preferences/set')
  })
})
