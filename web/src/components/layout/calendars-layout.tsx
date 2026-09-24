// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  AuthenticatedLayout,
  ConfirmDialog,
  CreateEntityDialog,
  MiniMonth,
  colourCheckbox,
  getErrorMessage,
  toast,
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

// Suppress the one-shot grant result on React StrictMode's double mount.
// Module scope, not the query itself: inside the shell's sandboxed iframe the
// replaceState below is dropped, so the query is still there on the second run.
const grantShown = new Set<string>()

export function CalendarsLayout() {
  const { t } = useLingui()
  const { isDesktop } = useScreenSize()
  const { ordered, isLoading, shown, toggle, only, date, setDate, today } =
    useCalendarContext()

  const [createOpen, setCreateOpen] = useState(false)
  const [subscribeOpen, setSubscribeOpen] = useState(false)
  // The Google account a consent just granted, which the wizard opens on.
  const [subscribeAccount, setSubscribeAccount] = useState<string | null>(null)
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
        error: (error) =>
          getErrorMessage(error, t`Failed to check the calendar`),
      })
    } catch {
      // toastAction already showed error
    }
  }

  // A linked calendar's poll is a two-way sync rather than a fetch, so it is
  // named for what it does.
  const sync = async (calendar: Calendar) => {
    try {
      await toastAction(pollMutation.mutateAsync(calendar.id), {
        loading: t`Syncing...`,
        success: t`Calendar synced`,
        error: (error) => getErrorMessage(error, t`Failed to sync the calendar`),
      })
    } catch {
      // toastAction already showed error
    }
  }

  // The provider's consent returns the browser here with the account it
  // granted, which opens the dialog at that account's calendars. The query is
  // dropped either way so a reload does not repeat it.
  useEffect(() => {
    const key = window.location.search
    if (grantShown.has(key)) return
    const params = new URLSearchParams(key)
    const granted = params.get('granted')
    const failed = params.get('grant_error')
    if (!granted && !failed) return
    grantShown.add(key)
    if (granted === 'calendar') {
      setSubscribeAccount(params.get('account'))
      setSubscribeOpen(true)
    }
    params.delete('granted')
    params.delete('account')
    params.delete('grant_error')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash
    )
    // Deferred a tick: the toaster subscribes in a sibling effect, and a
    // message published before it has is dropped.
    if (failed) {
      setTimeout(() => toast.error(t`Calendar access was not granted`), 0)
    }
  }, [t])

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
        } else if (calendar.kind === 'linked') {
          menu.push({
            title: t`Sync now`,
            icon: RefreshCw,
            onClick: () => void sync(calendar),
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
        // An event dragged from the views lands here to move to this calendar.
        drop: calendar.readonly ? undefined : calendar.id,
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
              onClick: () => {
                setSubscribeAccount(null)
                setSubscribeOpen(true)
              },
            },
            {
              id: 'connect-device',
              title: t`Connect device`,
              icon: Smartphone,
              onClick: () => setConnectOpen(true),
            },
            {
              id: 'preferences',
              title: t`Preferences`,
              icon: Settings,
              onClick: () => setPreferencesOpen(true),
            },
          ],
        },
      ],
    }
    // `poll`, `sync` and `copy` are recreated every render; the menu entries
    // only call them, so they are deliberately not dependencies.
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
              <MiniMonth selected={date} today={today} onSelect={setDate} />
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

      <SubscribeDialog
        open={subscribeOpen}
        onOpenChange={setSubscribeOpen}
        account={subscribeAccount}
      />


      <RenameDialog calendar={renaming} onClose={() => setRenaming(null)} />

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
