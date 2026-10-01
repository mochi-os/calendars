// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { plural, t } from '@lingui/core/macro'
import { useFormat } from '@mochi/web'
import { NO_REMINDER, REMINDER_LEADS } from '@/lib/ical'

interface Option {
  value: number
  label: string
}

// The two lists below are built where they are shown, inside a component that
// already subscribes to the interface language, so they follow a language
// change without being hooks of their own.

/** How long a new event lasts, in minutes; 0 ends it when it starts. */
export function durationOptions(): Option[] {
  return [0, 15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => ({
    value: minutes,
    label: durationLabel(minutes),
  }))
}

/** How long before the start a reminder fires, in minutes. */
export function reminderOptions(): Option[] {
  return [
    { value: NO_REMINDER, label: t`None` },
    ...REMINDER_LEADS.map((minutes) => ({
      value: minutes,
      label: reminderLabel(minutes),
    })),
  ]
}

/**
 * The choices for one of an event's reminders: those offered, and the one it
 * has when that is not among them, as a reminder another calendar set can be.
 */
export function reminderChoices(current: number): Option[] {
  const leads = REMINDER_LEADS.includes(current)
    ? REMINDER_LEADS
    : [...REMINDER_LEADS, current].sort((a, b) => a - b)
  return leads.map((minutes) => ({
    value: minutes,
    label: reminderLabel(minutes),
  }))
}

function reminderLabel(minutes: number): string {
  return minutes === 0 ? t`At the time of the event` : beforeLabel(minutes)
}

function durationLabel(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60
    return plural(hours, { one: '# hour', other: '# hours' })
  }
  return plural(minutes, { one: '# minute', other: '# minutes' })
}

function beforeLabel(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return plural(days, { one: '# day before', other: '# days before' })
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return plural(hours, { one: '# hour before', other: '# hours before' })
  }
  return plural(minutes, { one: '# minute before', other: '# minutes before' })
}

/** The hours of the day, named the way the user's clock reads them. */
export function useHourOptions(from: number, to: number): Option[] {
  const format = useFormat()
  const options: Option[] = []
  for (let hour = from; hour <= to; hour++) {
    // Midnight at the end of a day reads as 24:00 nowhere, so the last hour is
    // shown as the start of the next day, which is what it is.
    const at = format.timestampAt('2001-01-01', (hour % 24) * 60)
    options.push({ value: hour, label: format.formatHour(new Date(at * 1000)) })
  }
  return options
}
