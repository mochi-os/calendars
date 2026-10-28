// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { createFileRoute } from '@tanstack/react-router'
import {
  CalendarSettings,
  type CalendarTab,
} from '@/features/calendar/settings'

type CalendarSearch = {
  tab?: CalendarTab
}

// A calendar's own URL, /calendars/<fingerprint>, serves this same SPA; here
// it is that calendar's page rather than the overlay of everything.
export const Route = createFileRoute('/_authenticated/$calendarId')({
  validateSearch: (search: Record<string, unknown>): CalendarSearch => ({
    tab:
      search.tab === 'settings' || search.tab === 'publish'
        ? search.tab
        : undefined,
  }),
  component: CalendarSettingsPage,
})

function CalendarSettingsPage() {
  const { calendarId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <CalendarSettings
      fingerprint={calendarId}
      tab={tab}
      onTab={(next) => void navigate({ search: { tab: next }, replace: true })}
    />
  )
}
