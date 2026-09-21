// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { createFileRoute } from '@tanstack/react-router'
import { LocaleProvider, useAuthStore } from '@mochi/web'
import { CalendarProvider } from '@/context/calendar-context'
import { CalendarsLayout } from '@/components/layout/calendars-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const store = useAuthStore.getState()
    if (!store.isInitialized) {
      await store.initialize()
    }
  },
  component: Layout,
})

function Layout() {
  // AuthenticatedLayout carries a LocaleProvider of its own, but only around
  // the routed content - and the calendar's own state (which day is today,
  // where the week starts, which zone an event is written in) is decided
  // above it, in the provider and in the dialogs beside it. Without this they
  // read the UTC defaults while the views read the user's real preferences,
  // which is how the editor came to offer a timezone identical to the
  // user's own.
  return (
    <LocaleProvider>
      <CalendarProvider>
        <CalendarsLayout />
      </CalendarProvider>
    </LocaleProvider>
  )
}
