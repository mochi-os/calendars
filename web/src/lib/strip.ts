// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
// The day strip under the editor's times: one day on a line, the event a
// block on it that drags, stretches and jumps to a click. Times are minutes
// since midnight by the clock of the event's zone; the last is 23:59, since
// the editor keeps an event that ends at midnight on the next day.
import { currentZone, zonedMinutes } from '@mochi/web'
import type { Instance } from '@/api/types/events'
import type { EventDraft } from '@/lib/ical'

/** What a drag or a click on the strip lands on. */
export const STEP = 5

/** The last minute of the day. */
export const LAST = 24 * 60 - 1

/** Another event on the strip's day, as the minutes of the day it covers. */
export interface Block {
  start: number
  finish: number
  summary: string
  colour: string
}

const snapped = (minutes: number) => Math.round(minutes / STEP) * STEP
const within = (minutes: number, low: number, high: number) =>
  Math.min(high, Math.max(low, minutes))

/**
 * Whether the strip shows for a draft: a timed event that starts and ends on
 * one day in one zone. A flight across zones or an event over several days
 * is set with the fields alone.
 */
export function stripped(draft: EventDraft): boolean {
  return (
    !draft.allday &&
    draft.start === draft.finish &&
    currentZone(draft.zone.start) === currentZone(draft.zone.finish)
  )
}

/**
 * The span dragged along by `delta` minutes, its length kept: the start lands
 * on a step and the span stays within the day.
 */
export function moved(
  start: number,
  finish: number,
  delta: number
): { start: number; finish: number } {
  const length = finish - start
  const next = within(snapped(start + delta), 0, LAST - length)
  return { start: next, finish: next + length }
}

/**
 * The end dragged by `delta` minutes: on a step, at least a step after the
 * start, and within the day.
 */
export function resized(start: number, finish: number, delta: number): number {
  return within(snapped(finish + delta), start + STEP, LAST)
}

/**
 * The span moved to begin at the step the minute `at` falls in, its length
 * kept, as a click on an empty part of the day moves it.
 */
export function placed(
  start: number,
  finish: number,
  at: number
): { start: number; finish: number } {
  const length = finish - start
  const next = within(Math.floor(at / STEP) * STEP, 0, LAST - length)
  return { start: next, finish: next + length }
}

/**
 * The timed occurrences that fall on `day` in `zone`, as the minutes of that
 * day they cover, the one being edited left out. `from` and `to` are the
 * instants the day begins and ends, a clock change between them making the
 * day shorter or longer than 24 hours.
 */
export function blocks(
  instances: Instance[],
  from: number,
  to: number,
  zone: string,
  exclude?: { event: string; start: number }
): Block[] {
  const out: Block[] = []
  for (const instance of instances) {
    if (instance.allday) continue
    if (instance.finish <= from || instance.start >= to) continue
    if (
      exclude &&
      instance.event === exclude.event &&
      instance.start === exclude.start
    ) {
      continue
    }
    const start =
      instance.start <= from
        ? 0
        : zonedMinutes(new Date(instance.start * 1000), zone)
    const finish =
      instance.finish >= to
        ? 24 * 60
        : zonedMinutes(new Date(instance.finish * 1000), zone)
    out.push({
      start,
      finish: Math.max(finish, start + STEP),
      summary: instance.summary,
      colour: instance.colour,
    })
  }
  return out
}
