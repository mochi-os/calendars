// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  AuthenticatedLayout,
  ConfirmDialog,
  CreateEntityDialog,
  MiniMonth,
  colourCheckbox,
  getErrorMessage,
  toastAction,
  useScreenSize,
  type CreateEntityValues,
  type NavItem,
  type NavMenuItem,
  type SidebarData,
} from '@mochi/web'
import {
  CalendarDays,
  Copy,
  Eye,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Settings,
  Smartphone,
  Trash2,
} from 'lucide-react'
import type { Calendar } from '@/api/types/calendars'
import { useCalendarContext } from '@/context/calendar-context'
import {
  useCreateCalendarMutation,
  useDeleteCalendarMutation,
  usePollCalendarMutation,
} from '@/hooks/use-calendars'
import { useIcsCopy } from '@/hooks/use-ics-copy'
import { ColourDialog } from '@/features/calendar/dialogs/colour-dialog'
import { ConnectDialog } from '@/features/calendar/dialogs/connect-dialog'
import { PreferencesDialog } from '@/features/calendar/dialogs/preferences-dialog'
import { RenameDialog } from '@/features/calendar/dialogs/rename-dialog'
import { SubscribeDialog } from '@/features/calendar/dialogs/subscribe-dialog'
import { EventEditor } from '@/features/calendar/editor'

export function CalendarsLayout() {
  const { t } = useLingui()
  const { isDesktop } = useScreenSize()
  const {
    ordered,
    isLoading,
    shown,
    toggle,
    only,
    date,
    setDate,
    today,
    range,
  } = useCalendarContext()

  const [createOpen, setCreateOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [renaming, setRenaming] = useState<Calendar | null>(null)
  const [recolouring, setRecolouring] = useState<Calendar | null>(null)
  const [deleting, setDeleting] = useState<Calendar | null>(null)

  const createMutation = useCreateCalendarMutation()
  const deleteMutation = useDeleteCalendarMutation()
  const pollMutation = usePollCalendarMutation()
  const { copy } = useIcsCopy()

  const create = async (values: CreateEntityValues) => {
    await toastAction(
      createMutation.mutateAsync({
        name: values.name,
        colour: values.colour ?? '',
      }),
      {
        loading: t`Creating calendar...`,
        success: t`Calendar created`,
        error: (error) => getErrorMessage(error, t`Failed to create calendar`),
      }
    )
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await toastAction(deleteMutation.mutateAsync(deleting.id), {
        loading: t`Deleting calendar...`,
        success: t`Calendar deleted`,
        error: (error) => getErrorMessage(error, t`Failed to delete calendar`),
      })
      setDeleting(null)
    } catch {
      // toastAction already showed error
    }
  }

  const poll = async (calendar: Calendar) => {
    try {
      await toastAction(pollMutation.mutateAsync(calendar.id), {
        loading: t`Checking for changes...`,
        success: t`Calendar up to date`,
        error: (error) => getErrorMessage(error, t`Failed to check the calendar`),
      })
    } catch {
      // toastAction already showed error
    }
  }

  const sidebarData: SidebarData = useMemo(() => {
    const rows: NavItem[] = ordered.map((calendar) => {
      const checked = shown(calendar.id)
      const menu: NavMenuItem[] = []
      if (calendar.kind === 'birthdays') {
        menu.push({
          title: t`Colour`,
          icon: Palette,
          onClick: () => setRecolouring(calendar),
        })
      } else {
        menu.push(
          { title: t`Only this`, icon: Eye, onClick: () => only(calendar.id) },
          {
            title: t`Rename`,
            icon: Pencil,
            onClick: () => setRenaming(calendar),
          },
          {
            title: t`Colour`,
            icon: Palette,
            onClick: () => setRecolouring(calendar),
          }
        )
        if (calendar.kind === 'subscription') {
          menu.push({
            title: t`Poll now`,
            icon: RefreshCw,
            onClick: () => void poll(calendar),
          })
        }
        menu.push({
          title: t`Copy calendar address`,
          icon: Copy,
          onClick: () => void copy(calendar.id),
        })
        if (!calendar.default) {
          menu.push({
            title: t`Delete`,
            icon: Trash2,
            destructive: true,
            onClick: () => setDeleting(calendar),
          })
        }
      }
      return {
        id: calendar.id,
        title: calendar.name,
        icon: colourCheckbox(calendar.colour, checked),
        checked,
        onClick: () => toggle(calendar.id),
        menu,
      }
    })

    return {
      navGroups: [
        {
          title: t`Calendars`,
          animateList: true,
          items: [
            ...rows,
            {
              id: 'create-calendar',
              title: t`Create calendar`,
              icon: Plus,
              onClick: () => setCreateOpen(true),
            },
            {
              id: 'subscribe-calendar',
              title: t`Subscribe to calendar`,
              icon: Rss,
              onClick: () => setSubscribeOpen(true),
            },
            {
              id: 'preferences',
              title: t`Preferences`,
              icon: Settings,
              onClick: () => setPreferencesOpen(true),
            },
            {
              id: 'connect-device',
              title: t`Connect a device`,
              icon: Smartphone,
              onClick: () => setConnectOpen(true),
            },
          ],
        },
      ],
    }
    // `poll` and `copy` are recreated every render; the menu entries only call
    // them, so they are deliberately not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, shown, toggle, only, t])

  return (
    <>
      <AuthenticatedLayout
        sidebarData={sidebarData}
        isLoadingSidebar={isLoading && ordered.length === 0}
        sidebarHeader={
          isDesktop ? (
            <div className='pt-3'>
              <MiniMonth
                selected={date}
                today={today}
                highlight={{ from: range.from, days: range.days }}
                onSelect={setDate}
              />
            </div>
          ) : undefined
        }
      />

      <CreateEntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        hideTrigger
        icon={CalendarDays}
        title={t`Create calendar`}
        entityLabel={t`calendar`}
        showDescription={false}
        showColour
        onSubmit={create}
        isPending={createMutation.isPending}
      />

      <SubscribeDialog open={subscribeOpen} onOpenChange={setSubscribeOpen} />

      <RenameDialog
        calendar={renaming}
        onClose={() => setRenaming(null)}
      />

      <ColourDialog
        calendar={recolouring}
        onClose={() => setRecolouring(null)}
      />

      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
      />

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />

      <EventEditor />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t`Delete calendar`}
        desc={
          <Trans>
            Delete{' '}
            <span className='text-foreground font-semibold'>
              {deleting?.name ?? ''}
            </span>{' '}
            and every event on it?
          </Trans>
        }
        confirmText={
          <>
            <Trash2 className='size-4' />
            <Trans>Delete</Trans>
          </>
        }
        destructive
        handleConfirm={confirmDelete}
        isLoading={deleteMutation.isPending}
      />
    </>
  )
}
