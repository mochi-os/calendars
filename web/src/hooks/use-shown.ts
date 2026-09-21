// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useCallback } from 'react'
import { useShellStorage } from '@mochi/web'
import type { Calendar } from '@/api/types/calendars'

// Which calendars are shown is a viewing choice, kept per browser and never on
// the server. The hidden ones are what is stored, so a calendar made on
// another device - or one created after this browser last looked - is shown
// here without being listed anywhere first.
const HIDDEN = 'calendars:hidden'

export function useShownCalendars(calendars: Calendar[]) {
  const [hidden, setHidden] = useShellStorage<string[]>(HIDDEN, [])

  const shown = useCallback(
    (calendar: string) => !hidden.includes(calendar),
    [hidden]
  )

  const toggle = useCallback(
    (calendar: string) => {
      setHidden(
        hidden.includes(calendar)
          ? hidden.filter((id) => id !== calendar)
          : [...hidden, calendar]
      )
    },
    [hidden, setHidden]
  )

  const only = useCallback(
    (calendar: string) => {
      setHidden(calendars.map((c) => c.id).filter((id) => id !== calendar))
    },
    [calendars, setHidden]
  )

  const showAll = useCallback(() => setHidden([]), [setHidden])

  const hideAll = useCallback(
    () => setHidden(calendars.map((c) => c.id)),
    [calendars, setHidden]
  )

  const visible = calendars.filter((calendar) => shown(calendar.id))

  return { shown, toggle, only, showAll, hideAll, visible }
}
