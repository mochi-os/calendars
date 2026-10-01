// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { plural, t } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'
import { addDays, useFormat } from '@mochi/web'

type Format = ReturnType<typeof useFormat>

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
// 2024-01-07 was a Sunday, so weekday n falls n days after it.
const SUNDAY = '2024-01-07'
// The parts a summary can put into words; a rule with any other is not
// described.
const SAID = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'COUNT',
  'UNTIL',
  'WKST',
])

/**
 * A repeat rule the editor cannot express, put into words for the user:
 * "Every 2 weeks, on Tuesday and Thursday, 10 times". A rule with parts it
 * cannot say answers null, and nothing is shown.
 */
export function useRuleSummary() {
  // Read again when the language changes.
  useLingui()
  const format = useFormat()
  return (rule: string) => summary(rule, format)
}

function summary(rule: string, format: Format): string | null {
  const fields = new Map<string, string>()
  for (const part of rule.split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) return null
    fields.set(
      part.slice(0, at).trim().toUpperCase(),
      part
        .slice(at + 1)
        .trim()
        .toUpperCase()
    )
  }
  for (const key of fields.keys()) if (!SAID.has(key)) return null

  const interval = Number(fields.get('INTERVAL') ?? '1')
  if (!Number.isInteger(interval) || interval < 1) return null
  const parts: string[] = []
  switch (fields.get('FREQ')) {
    case 'DAILY':
      parts.push(plural(interval, { 1: 'Every day', other: 'Every # days' }))
      break
    case 'WEEKLY':
      parts.push(plural(interval, { 1: 'Every week', other: 'Every # weeks' }))
      break
    case 'MONTHLY':
      parts.push(
        plural(interval, { 1: 'Every month', other: 'Every # months' })
      )
      break
    case 'YEARLY':
      parts.push(plural(interval, { 1: 'Every year', other: 'Every # years' }))
      break
    default:
      return null
  }

  const byday = fields.get('BYDAY')
  if (byday) {
    const said = weekdays(byday, format)
    if (!said) return null
    parts.push(said)
  }

  const bymonthday = fields.get('BYMONTHDAY')
  if (bymonthday) {
    const said = monthdays(bymonthday, format)
    if (!said) return null
    parts.push(said)
  }

  const bymonth = fields.get('BYMONTH')
  if (bymonth) {
    const names: string[] = []
    for (const token of bymonth.split(',')) {
      const month = Number(token)
      if (!Number.isInteger(month) || month < 1 || month > 12) return null
      // The middle of the month at noon is the same month in every zone.
      names.push(
        format.formatMonthName(new Date(Date.UTC(2024, month - 1, 15, 12)), {
          inline: true,
        })
      )
    }
    const months = format.formatList(names)
    parts.push(t`in ${months}`)
  }

  const count = fields.get('COUNT')
  if (count !== undefined) {
    const times = Number(count)
    if (!Number.isInteger(times) || times < 1) return null
    parts.push(plural(times, { 1: 'once', other: '# times' }))
  }

  const until = fields.get('UNTIL')
  if (until !== undefined) {
    const found = /^(\d{4})(\d{2})(\d{2})/.exec(until)
    if (!found) return null
    const day = `${found[1]}-${found[2]}-${found[3]}`
    const date = format.formatDate(
      new Date(format.timestampAt(day, 720) * 1000)
    )
    parts.push(t`until ${date}`)
  }

  return parts.reduce((first, second) => t`${first}, ${second}`)
}

/** The weekdays a rule falls on: "on Tuesday and Thursday", "on the second Tuesday". */
function weekdays(value: string, format: Format): string | null {
  const plain: string[] = []
  const ordinal: string[] = []
  for (const token of value.split(',')) {
    const found = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim())
    if (!found) return null
    const day = format.formatWeekday(
      new Date(
        format.timestampAt(addDays(SUNDAY, WEEKDAYS.indexOf(found[2])), 720) *
          1000
      )
    )
    if (found[1] === undefined) {
      plain.push(day)
      continue
    }
    const nth = ordinalDay(Number(found[1]), day)
    if (!nth) return null
    ordinal.push(nth)
  }
  if (plain.length > 0 && ordinal.length > 0) return null
  if (ordinal.length > 0) return format.formatList(ordinal)
  const days = format.formatList(plain)
  return t`on ${days}`
}

function ordinalDay(position: number, day: string): string | null {
  switch (position) {
    case 1:
      return t`on the first ${day}`
    case 2:
      return t`on the second ${day}`
    case 3:
      return t`on the third ${day}`
    case 4:
      return t`on the fourth ${day}`
    case 5:
      return t`on the fifth ${day}`
    case -1:
      return t`on the last ${day}`
    default:
      return null
  }
}

/** The days of the month a rule falls on: "on days 1 and 15", "on the last day of the month". */
function monthdays(value: string, format: Format): string | null {
  const tokens = value.split(',').map((token) => Number(token))
  if (tokens.length === 1 && tokens[0] === -1)
    return t`on the last day of the month`
  if (tokens.some((day) => !Number.isInteger(day) || day < 1 || day > 31))
    return null
  const days = format.formatList(tokens.map((day) => format.formatNumber(day)))
  const count = tokens.length
  return plural(count, { 1: `on day ${days}`, other: `on days ${days}` })
}
