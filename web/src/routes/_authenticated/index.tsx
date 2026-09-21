// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { createFileRoute } from '@tanstack/react-router'
import { CalendarPage } from '@/features/calendar'

interface SearchParams {
  view?: string
  date?: string
}

export const Route = createFileRoute('/_authenticated/')({
  // `view` and `date` are the whole of the view's state, so a view is
  // bookmarkable and the back button steps through the days that were looked
  // at. Which calendars are shown is deliberately not here.
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    view: typeof search.view === 'string' ? search.view : undefined,
    date: typeof search.date === 'string' ? search.date : undefined,
  }),
  component: CalendarPage,
})
