// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { describe, expect, it } from 'vitest'
import { reminderChoices } from './use-options'

describe('reminderChoices', () => {
  it('offers the usual reminders', () => {
    expect(reminderChoices(15).map((option) => option.value)).toEqual([
      0, 5, 15, 30, 60, 1440,
    ])
  })

  it('adds, in its place, a reminder another calendar set to a time not offered', () => {
    const choices = reminderChoices(10)
    expect(choices.map((option) => option.value)).toEqual([
      0, 5, 10, 15, 30, 60, 1440,
    ])
    expect(choices.find((option) => option.value === 10)?.label).toBe(
      '10 minutes before'
    )
    expect(
      reminderChoices(2880).find((option) => option.value === 2880)?.label
    ).toBe('2 days before')
  })
})
