// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { createElement, type ReactNode } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRuleSummary } from './use-rule-summary'

function say(rule: string) {
  const { result } = renderHook(() => useRuleSummary(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(I18nProvider, { i18n }, children),
  })
  return result.current(rule)
}

describe('useRuleSummary', () => {
  it('says a monthly rule on an ordinal weekday in words', () => {
    expect(say('FREQ=MONTHLY;BYDAY=2TU')).toBe(
      'Every month, on the second Tuesday'
    )
  })

  it('says an interval, the weekdays and a count', () => {
    expect(say('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=10')).toBe(
      'Every 2 weeks, on Tuesday and Thursday, 10 times'
    )
  })

  it('says days of the month, and the last one', () => {
    expect(say('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBe(
      'Every month, on days 1 and 15'
    )
    expect(say('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe(
      'Every month, on the last day of the month'
    )
  })

  it('says a yearly rule on the last weekday of a month', () => {
    expect(say('FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')).toBe(
      'Every year, on the last Sunday, in March'
    )
  })

  it('says when the rule ends', () => {
    expect(say('FREQ=DAILY;COUNT=1')).toBe('Every day, once')
    expect(say('FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20271231T235959Z')).toMatch(
      /^Every month, on day 15, until /
    )
  })

  it('says nothing for a rule it cannot put into words', () => {
    expect(say('FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR')).toBeNull()
    expect(say('FREQ=HOURLY')).toBeNull()
    expect(say('FREQ=MONTHLY;BYDAY=6MO')).toBeNull()
    expect(say('FREQ=MONTHLY;BYMONTHDAY=-2')).toBeNull()
  })
})
