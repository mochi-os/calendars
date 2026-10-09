// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import type { NavMenuItem, SidebarData } from '@mochi/web'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Calendar } from '@/api/types/calendars'
import { CalendarsLayout } from './calendars-layout'

const state = vi.hoisted(() => ({
  calendars: [] as Calendar[],
  only: vi.fn(),
  copy: vi.fn(),
  export: vi.fn(),
  save: vi.fn(),
  error: vi.fn(),
  desktop: false,
  listed: undefined as string | undefined,
  /** The day the sidebar's month was last given as chosen. */
  picked: undefined as unknown,
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    // Each sidebar row as a region named for it, holding its menu's entries.
    AuthenticatedLayout: ({
      sidebarData,
      sidebarHeader,
    }: {
      sidebarData: SidebarData
      sidebarHeader?: React.ReactNode
    }) => (
      <div>
        {sidebarHeader}
        {sidebarData.navGroups
          .flatMap(
            (group) =>
              group.items as {
                id?: string
                title: string
                menu?: NavMenuItem[]
              }[]
          )
          .map((item) => (
            <section key={item.id ?? item.title} aria-label={item.title}>
              {(item.menu ?? []).map((entry) => (
                <button key={entry.title} onClick={entry.onClick}>
                  {entry.title}
                </button>
              ))}
            </section>
          ))}
      </div>
    ),
    CreateEntityDialog: () => null,
    ConfirmDialog: () => null,
    useScreenSize: () => ({ isDesktop: state.desktop }),
    MiniMonth: ({ selected }: { selected: unknown }) => {
      state.picked = selected
      return null
    },
    shellSaveBlob: state.save,
    // The toast the action would show for a failure, without the toaster.
    toastAction: async (
      promise: Promise<unknown>,
      messages: { error: (error: unknown) => string }
    ) => {
      try {
        return await promise
      } catch (error) {
        state.error(messages.error(error))
        throw error
      }
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}))

vi.mock('@/api/calendars', () => ({
  calendarsApi: { export: state.export },
}))

vi.mock('@/context/calendar-context', () => ({
  useCalendarContext: () => ({
    ordered: state.calendars,
    isLoading: false,
    shown: () => true,
    toggle: vi.fn(),
    only: state.only,
    date: '2026-10-02',
    setDate: vi.fn(),
    listed: state.listed,
    today: new Date(2026, 9, 2),
  }),
}))

vi.mock('@/hooks/use-calendars', () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    useCreateCalendarMutation: mutation,
    useDeleteCalendarMutation: mutation,
    usePollCalendarMutation: mutation,
  }
})

vi.mock('@/hooks/use-ics-copy', () => ({
  useIcsCopy: () => ({ copy: state.copy, revoke: vi.fn(), dialogs: null }),
}))

vi.mock('@/features/calendar/dialogs/import-dialog', () => ({
  ImportDialog: ({ calendar }: { calendar: Calendar | null }) =>
    calendar ? (
      <div role='dialog'>{`Importing into ${calendar.name}`}</div>
    ) : null,
}))
vi.mock('@/features/calendar/dialogs/colour-dialog', () => ({
  ColourDialog: () => null,
}))
vi.mock('@/features/calendar/dialogs/connect-dialog', () => ({
  ConnectDialog: () => null,
}))
vi.mock('@/features/calendar/dialogs/preferences-dialog', () => ({
  PreferencesDialog: () => null,
}))
vi.mock('@/features/calendar/dialogs/rename-dialog', () => ({
  RenameDialog: () => null,
}))
vi.mock('@/features/calendar/dialogs/subscribe-dialog', () => ({
  SubscribeDialog: () => null,
}))
vi.mock('@/features/calendar/editor', () => ({ EventEditor: () => null }))

function calendar(fields: Partial<Calendar>): Calendar {
  return {
    id: 'c1',
    fingerprint: 'f1',
    slug: '',
    name: 'Work',
    colour: '#3b82f6',
    kind: 'own',
    url: '',
    account: '',
    collection: '',
    readonly: false,
    default: false,
    version: 1,
    fetched: 0,
    failure: '',
    created: 0,
    updated: 0,
    ...fields,
  }
}

function show() {
  render(
    <I18nProvider i18n={i18n}>
      <CalendarsLayout />
    </I18nProvider>
  )
}

// jsdom's Blob has no text().
function read(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.readAsText(blob)
  })
}

// The entries in one calendar row's menu.
function menu(name: string) {
  return within(screen.getByRole('region', { name }))
}

describe('CalendarsLayout import and export', () => {
  beforeEach(() => {
    state.export
      .mockReset()
      .mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    state.save.mockReset().mockResolvedValue(true)
    state.error.mockReset()
    state.calendars = [
      calendar({ id: 'c1', name: 'Work', default: true }),
      calendar({
        id: 'c2',
        name: 'Holidays',
        kind: 'subscription',
        readonly: true,
      }),
      calendar({
        id: 'c3',
        name: 'Birthdays',
        kind: 'birthdays',
        readonly: true,
      }),
      calendar({ id: 'c4', name: 'Shared', kind: 'linked', readonly: true }),
      calendar({ id: 'c5', name: 'Team', kind: 'linked' }),
    ]
  })

  it('offers Import only on a calendar that is not read-only, and Export on every one', () => {
    show()
    for (const name of ['Work', 'Team']) {
      expect(
        menu(name).getByRole('button', { name: 'Import' })
      ).toBeInTheDocument()
      expect(
        menu(name).getByRole('button', { name: 'Export' })
      ).toBeInTheDocument()
    }
    for (const name of ['Holidays', 'Birthdays', 'Shared']) {
      expect(menu(name).queryByRole('button', { name: 'Import' })).toBeNull()
      expect(
        menu(name).getByRole('button', { name: 'Export' })
      ).toBeInTheDocument()
    }
  })

  it('opens the import dialog on the calendar chosen', () => {
    show()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(menu('Team').getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Importing into Team')
  })

  it('saves the export through the shell under the calendar name made safe for a file', async () => {
    state.calendars = [calendar({ id: 'c9', name: ' Work: "Q3" / plans. ' })]
    show()
    fireEvent.click(
      // The accessible name is the title with its edges trimmed.
      menu('Work: "Q3" / plans.').getByRole('button', { name: 'Export' })
    )
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    expect(state.export).toHaveBeenCalledWith('c9')
    const [blob, name] = state.save.mock.calls[0] as [Blob, string]
    expect(name).toBe('Work Q3 plans.ics')
    expect(blob.type).toBe('text/calendar')
    expect(await read(blob)).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')
    expect(state.error).not.toHaveBeenCalled()
  })

  it('falls back to a generic file name when nothing of the name is left', async () => {
    state.calendars = [
      calendar({ id: 'c3', name: '../?', kind: 'birthdays', readonly: true }),
    ]
    show()
    fireEvent.click(menu('../?').getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1))
    expect(state.save.mock.calls[0][1]).toBe('calendar.ics')
  })

  it('says why an export failed and saves nothing', async () => {
    state.export.mockRejectedValue(new Error('Calendar not found'))
    show()
    fireEvent.click(menu('Work').getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(state.error).toHaveBeenCalledWith('Calendar not found')
    )
    expect(state.save).not.toHaveBeenCalled()
  })

  it('says so when the shell does not save the file', async () => {
    state.save.mockResolvedValue(false)
    show()
    fireEvent.click(menu('Work').getByRole('button', { name: 'Export' }))
    await waitFor(() =>
      expect(state.error).toHaveBeenCalledWith('Failed to export calendar')
    )
  })
})

describe('CalendarsLayout birthdays menu', () => {
  beforeEach(() => {
    state.only.mockReset()
    state.copy.mockReset()
    state.calendars = [
      calendar({ id: 'c1', name: 'Work', default: true }),
      calendar({
        id: 'c3',
        name: 'Birthdays',
        kind: 'birthdays',
        readonly: true,
      }),
    ]
  })

  it('offers what Android does: only this, colour, its address and export', () => {
    show()
    const entries = menu('Birthdays')
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(entries).toEqual([
      'Only this',
      'Colour',
      'Copy calendar address',
      'Export',
    ])
  })

  it('shows the birthdays calendar alone', () => {
    show()
    fireEvent.click(
      menu('Birthdays').getByRole('button', { name: 'Only this' })
    )
    expect(state.only).toHaveBeenCalledWith('c3')
  })

  it('copies the birthdays calendar address', () => {
    show()
    fireEvent.click(
      menu('Birthdays').getByRole('button', { name: 'Copy calendar address' })
    )
    expect(state.copy).toHaveBeenCalledWith('c3')
  })
})

describe('CalendarsLayout month', () => {
  beforeEach(() => {
    state.calendars = []
    state.desktop = true
    state.listed = undefined
    state.picked = undefined
  })

  it("chooses the day the list has scrolled to in the sidebar's month, and the anchored day otherwise", () => {
    show()
    expect(state.picked).toBe('2026-10-02')
    cleanup()
    state.listed = '2026-10-12'
    show()
    expect(state.picked).toBe('2026-10-12')
  })
})
