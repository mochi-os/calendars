// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

type View = 'day' | 'week' | 'multiweek' | 'month' | 'list'

/** The user's own calendar settings, shared with the Android client. */
export interface Preferences {
  /** Working hours, as whole hours of the day. */
  hours: { start: number; finish: number }
  /** Work days, 0 = Sunday through 6 = Saturday. */
  days: number[]
  multiweek: { weeks: number; previous: number }
  /** Default event length in minutes. */
  duration: number
  /** Default reminder in minutes before the start; -1 is none. */
  reminder: number
  view: View
  /**
   * Show each event at its own wall-clock time, each end in the zone it was
   * written in, rather than converted into the user's zone.
   */
  zones: boolean
}

export interface PreferencesResponse {
  preferences: Preferences
}
