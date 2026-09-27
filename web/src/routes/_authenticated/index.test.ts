// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/features/calendar', () => ({ CalendarPage: () => null }))

const { Route } = await import('./index')

type Search = (search: Record<string, unknown>) => Record<string, unknown>
const validate = Route.options.validateSearch as unknown as Search

describe('the calendar route', () => {
  it("reads the event and occurrence a reminder's link names", () => {
    expect(
      validate({
        view: 'day',
        date: '2026-09-27',
        event: '01a0e3fd',
        occurrence: '1790532300',
      })
    ).toEqual({
      view: 'day',
      date: '2026-09-27',
      event: '01a0e3fd',
      occurrence: 1790532300,
    })
  })

  it('leaves them out when the link names none', () => {
    expect(validate({ view: 'month' })).toEqual({
      view: 'month',
      date: undefined,
      event: undefined,
      occurrence: undefined,
    })
    expect(validate({ event: '01a0e3fd', occurrence: 'soon' }).occurrence).toBe(
      undefined
    )
  })
})
