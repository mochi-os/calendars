// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  DatePicker,
  Button,
  ColourPicker,
  ConfirmDialog,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidePanel,
  SidePanelBody,
  SidePanelFooter,
  SidePanelHeader,
  SidePanelTitle,
  Skeleton,
  Switch,
  Textarea,
  TimePicker,
  TimezoneSelect,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  addDays,
  cn,
  GeneralError,
  getErrorMessage,
  toast,
  useFormat,
  useLeaveGuard,
} from '@mochi/web'
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CircleDashed,
  Clock,
  Copy as CopyIcon,
  Palette,
  Plus,
  Repeat as RepeatIcon,
  Trash2,
  X,
} from 'lucide-react'
import type { Component, Event } from '@/api/types/events'
import {
  copyDraft,
  formCopy,
  draftComponent,
  draftInstants,
  endAfterStart,
  startZone,
  expressible,
  emptyRepeat,
  masterComponent,
  nextReminder,
  openedDraft,
  savedComponents,
  savedSplit,
  type EventDraft,
  type Frequency,
  type Repeat,
  type Scope,
  shiftedStart,
} from '@/lib/ical'
import { useCalendarContext } from '@/context/calendar-context'
import { leavesSeries, useOccurrenceMove } from '@/hooks/use-event-move'
import {
  useCreateEventMutation,
  useEventQuery,
  useSplitEventMutation,
  useUpdateEventMutation,
} from '@/hooks/use-events'
import { reminderChoices } from '@/hooks/use-options'
import { useRuleSummary } from '@/hooks/use-rule-summary'
import { CountInput } from '@/features/calendar/components/count-input'
import { DeleteEventDialog } from '@/features/calendar/components/delete-event-dialog'
import { ScopeDialog } from '@/features/calendar/components/scope-dialog'

const WEEKDAY_ANCHOR = '2024-01-07'

// How long typing in a one-time event rests before it is saved.
const PAUSE = 1000

/**
 * Whether a repeat needs the custom panel to show all of it: an interval,
 * weekdays or an end, which the plain choices would hide. A copy opens on
 * the same test as an edit, so its series reads as it will save.
 */
function customised(repeat: Repeat): boolean {
  return (
    repeat.interval > 1 ||
    repeat.weekdays.length > 0 ||
    repeat.ending !== 'never'
  )
}

export function EventEditor() {
  const { t } = useLingui()
  const format = useFormat()
  const {
    editing,
    setEditing,
    ordered: listed,
    remember,
    reveal,
  } = useCalendarContext()

  const editingEvent = editing?.mode === 'edit' ? editing.event : null
  const { data, isLoading, isError, error, refetch } =
    useEventQuery(editingEvent)
  const event = data?.event

  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [custom, setCustom] = useState(false)
  // The scope a series' save waits on: for a save, or for the save closing
  // makes, or for a copy.
  const [asking, setAsking] = useState<'save' | 'close' | 'copy' | null>(null)
  // A save tried without a title; the title row says so until one is typed.
  const [untitled, setUntitled] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Closing with a change that cannot be saved: no title, or an end before
  // the start.
  const [discarding, setDiscarding] = useState(false)

  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const splitMutation = useSplitEventMutation()
  const moveOccurrence = useOccurrenceMove()

  const writable = useMemo(
    () => listed.filter((calendar) => !calendar.readonly),
    [listed]
  )

  // The draft as last rendered, which a save started by a timer, a blur or
  // closing reads.
  const latest = useRef(draft)
  latest.current = draft
  // The event as last written or read, whose etag and components the next
  // save is made against, and the draft as that event reads, which tells a
  // change from none. A new event has neither until it is created.
  const stored = useRef<Event | null>(null)
  const base = useRef<string | null>(null)
  // Which opening the form was last read for.
  const seeded = useRef<typeof editing>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The save under way, and whether another was asked for meanwhile: saves go
  // one at a time, each against the etag the one before it was answered with.
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  // A save was refused because the event changed elsewhere: nothing more is
  // written over it until Reload reads it again.
  const refused = useRef(false)

  const dirty = useCallback(
    () =>
      latest.current !== null &&
      base.current !== null &&
      JSON.stringify(latest.current) !== base.current,
    []
  )

  // A create opens on the draft it was given. An edit waits for the stored
  // event, then reads the occurrence's own component where it has one. The
  // same event read again, written here or changed elsewhere, replaces the
  // form only while it holds nothing unsaved.
  useEffect(() => {
    if (!editing) {
      seeded.current = null
      stored.current = null
      base.current = null
      setUntitled(false)
      setDraft(null)
      setAsking(null)
      setConfirming(false)
      setDiscarding(false)
      return
    }
    if (editing.mode === 'create') {
      if (seeded.current === editing) return
      seeded.current = editing
      stored.current = null
      base.current = null
      setUntitled(false)
      setDraft(editing.draft)
      setCustom(customised(editing.draft.repeat))
      return
    }
    if (!event || event.id !== editing.event) return
    const same =
      seeded.current?.mode === 'edit' && seeded.current.event === editing.event
    if (same) {
      seeded.current = editing
      if (stored.current?.etag === event.etag) return
      if (dirty()) return
    }
    const read = openedDraft(
      event.components,
      editing.start,
      event.calendar,
      format.timezone,
      event.recurring
    )
    if (!read) return
    seeded.current = editing
    stored.current = event
    base.current = JSON.stringify(read)
    latest.current = read
    setUntitled(false)
    setDraft(read)
    setCustom(customised(read.repeat))
  }, [editing, event, format.timezone, dirty])

  const close = () => setEditing(null)

  // The panel goes on as the event a save made or moved, at the occurrence's
  // new start. Another event is read afresh; the same one keeps the form.
  const follow = (id: string, start: number) =>
    setEditing({ mode: 'edit', event: id, start })

  const recurring = Boolean(event?.recurring) && editing?.mode === 'edit'

  // The end may read earlier than the start by the clock, across zones, but
  // never as an instant.
  const ordered = draft
    ? draftInstants(draft).finish >= draftInstants(draft).start
    : true

  const write = async (scope: Scope): Promise<boolean> => {
    const current = latest.current
    const event = stored.current
    if (!current || !event || editing?.mode !== 'edit') return false
    const start = editing.start
    const moved = draftInstants(current).start
    try {
      const master = masterComponent(event.components)
      // This occurrence and the ones after it become a series of their own,
      // starting where this one now falls. The first occurrence has nothing
      // before it, so that is the whole series.
      if (event.recurring && scope === 'following' && master) {
        const split = savedSplit(
          event.components,
          current,
          start,
          format.timezone
        )
        if (split) {
          const result = await splitMutation.mutateAsync({
            event: event.id,
            etag: event.etag,
            start,
            components: split.before,
            following: split.after,
            calendar: current.calendar,
          })
          reveal(current.calendar)
          follow(result.following.id, moved)
          return true
        }
        scope = 'all'
      }
      // One occurrence taken to another calendar leaves the series behind
      // and becomes an event of its own there.
      if (
        leavesSeries(event.recurring, scope, event.calendar, current.calendar)
      ) {
        const { created } = await moveOccurrence(
          event,
          start,
          current,
          current.calendar,
          format.timezone
        )
        reveal(current.calendar)
        follow(created.id, moved)
        return true
      }
      const components: Component[] = event.recurring
        ? savedComponents(
            event.components,
            current,
            scope,
            start,
            format.timezone
          )
        : [draftComponent(current, master ?? undefined)]
      const result = await updateMutation.mutateAsync({
        event: event.id,
        etag: event.etag,
        calendar: current.calendar,
        components,
      })
      stored.current = result.event
      base.current = JSON.stringify(current)
      reveal(current.calendar)
      if (moved !== start) follow(event.id, moved)
      return true
    } catch (error) {
      if ((error as { status?: number })?.status === 412) {
        refused.current = true
        toast.error(t`This event changed somewhere else.`, {
          action: {
            label: t`Reload`,
            onClick: () => {
              refused.current = false
              seeded.current = null
              void refetch()
            },
          },
        })
        return false
      }
      toast.error(getErrorMessage(error, t`Failed to save the event`))
      return false
    }
  }

  // Save what the form holds now, after any save already under way. A series
  // asks which of it the change is for; a change that cannot be saved waits,
  // and closing with one asks before it is dropped.
  const save = (closing = false): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (running.current) {
      again.current = true
      return running.current.then(() => {
        if (closing) save(true)
      })
    }
    const current = latest.current
    if (
      editing?.mode !== 'edit' ||
      !stored.current ||
      !current ||
      !dirty() ||
      refused.current
    ) {
      if (closing) close()
      return Promise.resolve()
    }
    if (current.title.trim() === '' || !ordered) {
      if (current.title.trim() === '') setUntitled(true)
      if (closing) setDiscarding(true)
      return Promise.resolve()
    }
    if (stored.current.recurring) {
      setAsking(closing ? 'close' : 'save')
      return Promise.resolve()
    }
    const run = write('all')
      .then((ok) => {
        if (ok && closing) close()
      })
      .finally(() => {
        running.current = null
        if (again.current) {
          again.current = false
          void save()
        }
      })
    running.current = run
    return run
  }

  const saveRef = useRef(save)
  saveRef.current = save

  // A one-time event saves once typing rests; a series waits for its field
  // to be left, since each of its saves asks which occurrences it is for.
  const changeDraft: typeof setDraft = (update) => {
    setDraft(update)
    if (editing?.mode !== 'edit' || recurring) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void saveRef.current(), PAUSE)
  }

  // Leaving a field for another in the panel saves it; focus going into a
  // field's own picker, which opens outside the panel, does not.
  const left = (focus: React.FocusEvent) => {
    if (editing?.mode !== 'edit') return
    const panel = focus.currentTarget.closest('[data-slot="side-panel"]')
    const next = focus.relatedTarget
    if (panel && next instanceof Node && panel.contains(next)) void save()
  }

  const create = async () => {
    const current = latest.current
    if (!current || editing?.mode !== 'create') return
    if (current.title.trim() === '') {
      setUntitled(true)
      document.getElementById('event-title')?.focus()
      return
    }
    if (!ordered) return
    try {
      const result = await createMutation.mutateAsync({
        calendar: current.calendar,
        components: [draftComponent(current)],
      })
      remember(current)
      reveal(current.calendar)
      toast.success(t`Event created`)
      follow(result.event.id, draftInstants(current).start)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to save the event`))
    }
  }

  // A copy is made at once, in the calendar the form shows, and opens in the
  // panel. A change not yet saved goes into the copy rather than being
  // dropped; a series asks which of it to copy.
  const duplicate = async (scope: 'one' | 'all') => {
    const current = latest.current
    const event = stored.current
    if (!current || !event || editing?.mode !== 'edit') return
    const copied = dirty()
      ? formCopy(
          current,
          event.components,
          editing.start,
          format.timezone,
          scope,
          event.recurring
        )
      : copyDraft(
          event.components,
          editing.start,
          current.calendar,
          format.timezone,
          scope
        )
    if (!copied) return
    try {
      const result = await createMutation.mutateAsync({
        calendar: copied.calendar,
        components: [draftComponent(copied)],
      })
      reveal(copied.calendar)
      toast.success(t`Event copied`)
      follow(result.event.id, draftInstants(copied).start)
    } catch (error) {
      toast.error(getErrorMessage(error, t`Failed to save the event`))
    }
  }

  const copy = () => {
    if (recurring) setAsking('copy')
    else void duplicate('one')
  }

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    splitMutation.isPending

  const open = editing !== null
  // A new event typed into and not created, or a series' change not yet
  // given its scope, is what closing or leaving could lose.
  const unsaved =
    draft !== null &&
    (editing?.mode === 'create'
      ? JSON.stringify(draft) !== JSON.stringify(editing.draft)
      : recurring &&
        base.current !== null &&
        JSON.stringify(draft) !== base.current)

  // X, Escape and a click outside come through here. A new event with
  // something typed asks before it is dropped; an edit saves on the way out.
  const requestClose = () => {
    if (pending) return
    if (editing?.mode === 'create') {
      if (unsaved) setDiscarding(true)
      else close()
      return
    }
    void save(true)
  }

  // The shell's back, forward and cross-app links take the page, and the
  // panel with it, without closing it first, so while it holds something
  // only it can save they ask the question closing does.
  const leaving = useLeaveGuard(open && unsaved)

  // A one-time event's change still waiting for its pause is saved when the
  // panel goes.
  useEffect(() => {
    if (open) return
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [open])

  const body =
    isError && editing?.mode === 'edit' && !draft ? (
      <GeneralError
        mode='inline'
        className='my-4'
        error={error}
        reset={() => void refetch()}
      />
    ) : isLoading && editing?.mode === 'edit' && !draft ? (
      <div className='space-y-3'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-24 w-full' />
      </div>
    ) : draft ? (
      <div onBlur={left}>
        <EditorFields
          draft={draft}
          ordered={ordered}
          untitled={untitled && draft.title.trim() === ''}
          onSave={() => {
            if (pending) return
            if (editing?.mode === 'create') void create()
            else void save()
          }}
          setDraft={changeDraft}
          custom={custom}
          setCustom={setCustom}
          calendars={writable.map((calendar) => ({
            id: calendar.id,
            name: calendar.name,
          }))}
        />
      </div>
    ) : null

  const action = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    disabled: boolean
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )

  const actions =
    editing?.mode === 'edit' ? (
      <>
        {action(
          t`Copy`,
          <CopyIcon className='size-4' />,
          copy,
          pending || !event
        )}
        {action(
          t`Delete`,
          <Trash2 className='size-4' />,
          () => setConfirming(true),
          pending
        )}
      </>
    ) : undefined

  const title =
    editing?.mode === 'create'
      ? t`New event`
      : event?.summary.trim() || t`Edit event`

  return (
    <>
      <SidePanel
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
        size='xl'
        dismissOnOutsideClick
        onOpenAutoFocus={(focus) => {
          // A new event starts at its title; an open one takes no focus, so
          // a phone's keyboard does not cover it.
          focus.preventDefault()
          if (editing?.mode === 'create')
            document.getElementById('event-title')?.focus()
        }}
      >
        <SidePanelHeader actions={actions}>
          <SidePanelTitle>{title}</SidePanelTitle>
        </SidePanelHeader>
        <SidePanelBody>{body}</SidePanelBody>
        {editing?.mode === 'create' && (
          <SidePanelFooter>
            <div className='flex justify-end'>
              <Button
                onClick={() => void create()}
                loading={pending}
                disabled={!draft}
                icon={<Plus className='size-4' />}
              >
                <Trans>Create</Trans>
              </Button>
            </div>
          </SidePanelFooter>
        )}
      </SidePanel>

      <ScopeDialog
        open={asking === 'save' || asking === 'close'}
        title={t`Save this event`}
        icon={<Check className='size-4' />}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        onChoose={(scope) => {
          const closing = asking === 'close'
          setAsking(null)
          void write(scope).then((ok) => {
            if (ok && closing) close()
          })
        }}
      />

      <ScopeDialog
        open={asking === 'copy'}
        title={t`Copy this event`}
        following={false}
        icon={<CopyIcon className='size-4' />}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        onChoose={(scope) => {
          setAsking(null)
          void duplicate(scope === 'all' ? 'all' : 'one')
        }}
      />

      <ConfirmDialog
        open={discarding || leaving.asking}
        onOpenChange={(next) => {
          if (next) return
          setDiscarding(false)
          leaving.stay()
        }}
        title={t`Discard draft?`}
        desc={t`Your changes will be lost.`}
        confirmText={t`Discard`}
        icon={<Trash2 className='size-4' />}
        destructive
        handleConfirm={() => {
          if (leaving.asking) leaving.proceed()
          setDiscarding(false)
          close()
        }}
      />

      <DeleteEventDialog
        event={confirming && editing?.mode === 'edit' ? editing.event : null}
        start={editing?.mode === 'edit' ? editing.start : 0}
        onClose={() => setConfirming(false)}
        onDeleted={close}
      />
    </>
  )
}

function EditorFields({
  draft,
  setDraft,
  custom,
  setCustom,
  calendars,
  ordered,
  untitled,
  onSave,
}: {
  draft: EventDraft
  setDraft: React.Dispatch<React.SetStateAction<EventDraft | null>>
  custom: boolean
  setCustom: (value: boolean) => void
  calendars: { id: string; name: string }[]
  /** Whether the end follows the start as instants; Save waits for that. */
  ordered: boolean
  /** A save was tried without a title, which the title row says. */
  untitled: boolean
  /** Enter in the title: the Save button's own path, asks and all. */
  onSave: () => void
}) {
  const { t } = useLingui()
  const format = useFormat()

  // A rule read from the event that the repeat settings cannot express is
  // shown as custom and written back as it was.
  const kept = !expressible(draft.repeat.rule)
  const summarise = useRuleSummary()
  const summary = kept ? summarise(draft.repeat.rule) : null

  // The fields only render with a draft in hand, so an update never has to
  // answer for the null the editor starts in.
  const edit = (update: (current: EventDraft) => EventDraft) =>
    setDraft((current) => (current ? update(current) : current))

  // Moving the start carries the end with it, which is what every calendar
  // does: the length the user set is the thing worth keeping.
  const moveStart = (day: string, minutes: number) => {
    edit((current) => shiftedStart(current, day, minutes))
  }

  const weekdays = useMemo(() => {
    const out: { day: number; label: string }[] = []
    for (let offset = 0; offset < 7; offset++) {
      const day = (format.weekStartsOn + offset) % 7
      const at = format.timestampAt(addDays(WEEKDAY_ANCHOR, day), 720)
      out.push({ day, label: format.formatWeekdayShort(new Date(at * 1000)) })
    }
    return out
  }, [format])

  // The calendar and the fields running the full width carry their label
  // inside them, as their name and the text shown while they are empty.
  const titled = t`Title`
  const described = t`Description`
  const located = t`Location`
  const linked = t`URL`

  return (
    // From small screens up, each label sits in a column beside its field;
    // the calendar, title, description, location and URL run the full width
    // with their label inside.
    <div className='space-y-4 px-1 sm:grid sm:grid-cols-[max-content_minmax(0,1fr)] sm:items-start sm:space-y-0 sm:gap-x-4 sm:gap-y-3'>
      <div className='sm:col-span-2'>
        <Select
          value={draft.calendar}
          onValueChange={(value) =>
            edit((current) => ({ ...current, calendar: value }))
          }
        >
          <SelectTrigger
            id='event-calendar'
            aria-label={t`Calendar`}
            className='w-full'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {calendars.map((calendar) => (
              <SelectItem key={calendar.id} value={calendar.id}>
                <CalendarDays className='size-4' />
                {calendar.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='space-y-2 sm:col-span-2'>
        <Input
          id='event-title'
          aria-label={titled}
          placeholder={titled}
          value={draft.title}
          autoFocus
          aria-invalid={untitled || undefined}
          onChange={(input) =>
            edit((current) => ({ ...current, title: input.target.value }))
          }
          // Only the title: the pickers and selects below take Enter for
          // themselves. A key that ends an IME composition is not a save.
          onKeyDown={(key) => {
            if (key.key === 'Enter' && !key.nativeEvent.isComposing) {
              key.preventDefault()
              onSave()
            }
          }}
        />
        {untitled && (
          <p className='text-destructive text-xs' data-testid='untitled'>
            {t`Title is required`}
          </p>
        )}
      </div>

      <div className='sm:col-span-2'>
        {/* Two lines to start, growing with what is typed. */}
        <Textarea
          id='event-description'
          aria-label={described}
          placeholder={described}
          rows={2}
          className='min-h-0'
          value={draft.description}
          onChange={(input) =>
            edit((current) => ({
              ...current,
              description: input.target.value,
            }))
          }
        />
      </div>

      <div className='sm:col-span-2'>
        <Input
          id='event-location'
          aria-label={located}
          placeholder={located}
          value={draft.location}
          onChange={(input) =>
            edit((current) => ({
              ...current,
              location: input.target.value,
            }))
          }
        />
      </div>

      <div className='sm:col-span-2'>
        <Input
          id='event-url'
          type='url'
          aria-label={linked}
          placeholder={linked}
          value={draft.url ?? ''}
          onChange={(input) =>
            edit((current) => ({ ...current, url: input.target.value }))
          }
        />
      </div>

      <Row
        inline
        htmlFor='event-allday'
        icon={<Clock className='size-4' />}
        label={<Trans>All day</Trans>}
      >
        <Switch
          id='event-allday'
          checked={draft.allday}
          onCheckedChange={(value) =>
            edit((current) => ({ ...current, allday: value }))
          }
        />
        <Label
          htmlFor='event-tentative'
          className='ml-auto flex items-center gap-2 sm:ml-6'
        >
          <CircleDashed className='size-4' />
          <Trans context='event status'>Tentative</Trans>
        </Label>
        <Switch
          id='event-tentative'
          checked={draft.tentative ?? false}
          onCheckedChange={(value) =>
            edit((current) => ({ ...current, tentative: value }))
          }
        />
      </Row>

      <Row
        htmlFor='event-start'
        icon={<CalendarClock className='size-4' />}
        label={<Trans>Start</Trans>}
      >
        <div className='@container flex flex-wrap gap-2'>
          <DatePicker
            id='event-start'
            className='min-w-36 flex-1'
            value={draft.start}
            onChange={(day) => moveStart(day || draft.start, draft.startTime)}
          />
          {!draft.allday && (
            <TimePicker
              className={TIMED}
              aria-label={t`Start time`}
              value={draft.startTime}
              onChange={(minutes) => moveStart(draft.start, minutes)}
            />
          )}
          {/* Each end's zone sits beside its time, the same width in both
              rows so the two line up. An all-day event has no time, and
              its days are the user's own. */}
          {draft.allday ? (
            <Timeless />
          ) : (
            <TimezoneSelect
              compact
              auto={false}
              className={ZONED}
              label={t`Start time zone`}
              value={draft.zone.start}
              onChange={(zone) =>
                edit((current) =>
                  endAfterStart({
                    ...current,
                    zone: startZone(current.zone, zone),
                  })
                )
              }
            />
          )}
        </div>
      </Row>

      <Row
        htmlFor='event-finish'
        icon={<CalendarClock className='size-4' />}
        label={<Trans>End</Trans>}
      >
        <div className='@container flex flex-wrap gap-2'>
          <DatePicker
            id='event-finish'
            className='min-w-36 flex-1'
            value={draft.finish}
            onChange={(day) =>
              edit((current) => ({
                ...current,
                finish: day || current.finish,
              }))
            }
          />
          {!draft.allday && (
            <TimePicker
              className={TIMED}
              aria-label={t`End time`}
              value={draft.finishTime}
              onChange={(minutes) =>
                edit((current) => ({ ...current, finishTime: minutes }))
              }
            />
          )}
          {draft.allday ? (
            <Timeless />
          ) : (
            <TimezoneSelect
              compact
              auto={false}
              className={ZONED}
              label={t`End time zone`}
              value={draft.zone.finish}
              onChange={(zone) =>
                edit((current) =>
                  endAfterStart({
                    ...current,
                    zone: { ...current.zone, finish: zone },
                  })
                )
              }
            />
          )}
        </div>
        {/* Save waits for an end that follows the start; the row says why. */}
        {!ordered && (
          <p className='text-destructive text-xs' data-testid='backwards'>
            {t`Ends before it starts`}
          </p>
        )}
      </Row>

      <Row
        htmlFor='event-repeat'
        icon={<RepeatIcon className='size-4' />}
        label={<Trans>Repeat</Trans>}
      >
        <Select
          value={custom || kept ? 'custom' : draft.repeat.frequency}
          onValueChange={(value) => {
            if (value === 'custom') {
              setCustom(true)
              edit((current) => ({
                ...current,
                repeat: {
                  ...current.repeat,
                  rule: '',
                  frequency:
                    current.repeat.frequency === 'never'
                      ? 'weekly'
                      : current.repeat.frequency,
                },
              }))
              return
            }
            setCustom(false)
            edit((current) => ({
              ...current,
              repeat: { ...emptyRepeat(), frequency: value as Frequency },
            }))
          }}
        >
          <SelectTrigger id='event-repeat' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='never'>
              {t({ message: 'Never', context: 'repeat' })}
            </SelectItem>
            <SelectItem value='daily'>{t`Daily`}</SelectItem>
            <SelectItem value='weekly'>{t`Weekly`}</SelectItem>
            <SelectItem value='monthly'>{t`Monthly`}</SelectItem>
            <SelectItem value='yearly'>{t`Yearly`}</SelectItem>
            <SelectItem value='custom'>{t`Custom`}</SelectItem>
          </SelectContent>
        </Select>
        {/* A rule the settings cannot express is kept as written; choosing
            a repeat replaces it. */}
        {summary && (
          <p className='text-muted-foreground text-xs' data-testid='kept-rule'>
            {summary}
          </p>
        )}
      </Row>

      {custom && !kept && (
        <div className='space-y-3 rounded-lg border p-3 sm:col-start-2'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='repeat-frequency'>
                <Trans>Frequency</Trans>
              </Label>
              <Select
                value={draft.repeat.frequency}
                onValueChange={(value) =>
                  edit((current) => ({
                    ...current,
                    repeat: {
                      ...current.repeat,
                      rule: '',
                      frequency: value as Frequency,
                    },
                  }))
                }
              >
                <SelectTrigger id='repeat-frequency' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='daily'>{t`Daily`}</SelectItem>
                  <SelectItem value='weekly'>{t`Weekly`}</SelectItem>
                  <SelectItem value='monthly'>{t`Monthly`}</SelectItem>
                  <SelectItem value='yearly'>{t`Yearly`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='repeat-interval'>
                <Trans>Every</Trans>
              </Label>
              <CountInput
                id='repeat-interval'
                maximum={366}
                value={draft.repeat.interval}
                onChange={(interval) =>
                  edit((current) => ({
                    ...current,
                    repeat: { ...current.repeat, rule: '', interval },
                  }))
                }
              />
            </div>
          </div>

          {draft.repeat.frequency === 'weekly' && (
            <div className='flex flex-wrap gap-1'>
              {weekdays.map((weekday) => {
                const on = draft.repeat.weekdays.includes(weekday.day)
                return (
                  <button
                    key={weekday.day}
                    type='button'
                    aria-pressed={on}
                    onClick={() =>
                      edit((current) => ({
                        ...current,
                        repeat: {
                          ...current.repeat,
                          rule: '',
                          weekdays: on
                            ? current.repeat.weekdays.filter(
                                (day) => day !== weekday.day
                              )
                            : [...current.repeat.weekdays, weekday.day].sort(),
                        },
                      }))
                    }
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-sm',
                      on
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'hover:bg-hover'
                    )}
                  >
                    {weekday.label}
                  </button>
                )
              })}
            </div>
          )}

          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='repeat-ending'>
                <Trans>Ends</Trans>
              </Label>
              <Select
                value={draft.repeat.ending}
                onValueChange={(value) =>
                  edit((current) => ({
                    ...current,
                    repeat: {
                      ...current.repeat,
                      rule: '',
                      ending: value as EventDraft['repeat']['ending'],
                      until:
                        value === 'until' && !current.repeat.until
                          ? addDays(current.start, 28)
                          : current.repeat.until,
                    },
                  }))
                }
              >
                <SelectTrigger id='repeat-ending' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='never'>
                    {t({ message: 'Never', context: 'repeat end' })}
                  </SelectItem>
                  <SelectItem value='until'>{t`On a date`}</SelectItem>
                  <SelectItem value='count'>{t`After a number`}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.repeat.ending === 'until' && (
              <div className='space-y-2'>
                <Label htmlFor='repeat-until'>
                  <Trans>Last day</Trans>
                </Label>
                <DatePicker
                  id='repeat-until'
                  value={draft.repeat.until}
                  onChange={(day) => {
                    // A cleared field would save a series that never ends
                    // while the form still says it ends on a date.
                    if (!day) return
                    edit((current) => ({
                      ...current,
                      repeat: { ...current.repeat, rule: '', until: day },
                    }))
                  }}
                />
              </div>
            )}
            {draft.repeat.ending === 'count' && (
              <div className='space-y-2'>
                <Label htmlFor='repeat-count'>
                  <Trans>Occurrences</Trans>
                </Label>
                <CountInput
                  id='repeat-count'
                  maximum={999}
                  value={draft.repeat.count}
                  onChange={(count) =>
                    edit((current) => ({
                      ...current,
                      repeat: { ...current.repeat, rule: '', count },
                    }))
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      <Row
        htmlFor='event-reminder'
        icon={<Bell className='size-4' />}
        label={<Trans>Reminder</Trans>}
      >
        {draft.reminders.map((minutes, index) => (
          <div key={index} className='flex items-center gap-1'>
            <Select
              value={String(minutes)}
              onValueChange={(value) =>
                edit((current) => ({
                  ...current,
                  reminders: current.reminders.map((each, at) =>
                    at === index ? Number(value) : each
                  ),
                }))
              }
            >
              <SelectTrigger
                id={index === 0 ? 'event-reminder' : undefined}
                aria-label={t`Reminder`}
                className='w-full'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reminderChoices(minutes).map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={t`Remove reminder`}
              onClick={() =>
                edit((current) => ({
                  ...current,
                  reminders: current.reminders.filter((_, at) => at !== index),
                }))
              }
            >
              <X className='size-4' />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          variant='outline'
          size='sm'
          id={draft.reminders.length === 0 ? 'event-reminder' : undefined}
          onClick={() =>
            edit((current) => ({
              ...current,
              reminders: [
                ...current.reminders,
                nextReminder(current.reminders),
              ],
            }))
          }
        >
          <Plus className='size-4' />
          <Trans>Add reminder</Trans>
        </Button>
      </Row>

      <Row icon={<Palette className='size-4' />} label={<Trans>Colour</Trans>}>
        {draft.colour && !/^#[0-9a-fA-F]{6}$/.test(draft.colour) && (
          <Input
            aria-label={t`Colour value`}
            value={draft.colour}
            onChange={(input) =>
              edit((current) => ({ ...current, colour: input.target.value }))
            }
          />
        )}
        <ColourPicker
          collapsible
          value={
            /^#[0-9a-fA-F]{6}$/.test(draft.colour ?? '') ? draft.colour! : ''
          }
          onChange={(colour) => edit((current) => ({ ...current, colour }))}
          onClear={() => edit((current) => ({ ...current, colour: '' }))}
        />
      </Row>
    </div>
  )
}

/** An end's time beside its date. */
const TIMED = 'w-32 shrink-0'

/**
 * An end's zone beside its time: wide enough for every zone's city, the
 * longest of which, Bahia Banderas, takes 100 of the 110 pixels it leaves the
 * name beside the globe.
 */
const ZONED = 'w-40 shrink-0'

/**
 * An all-day event's room where a timed one has its time and zone, so turning
 * All day on hides them without moving the dates. Where the row is narrower
 * than its date's least width, the time and the zone (9 + 8 + 10 rem and two
 * gaps, 28 rem), the zone wraps under the time, and its room goes rather than
 * leave an empty line.
 */
function Timeless() {
  return (
    <>
      <span aria-hidden className={TIMED} data-testid='time-room' />
      <span
        aria-hidden
        className={cn(ZONED, '@max-[28rem]:hidden')}
        data-testid='zone-room'
      />
    </>
  )
}

/**
 * One field of the editor. From small screens up its label sits in the
 * grid's first column beside the control, level with the control's first
 * line; on a phone the label sits above, or beside an [inline] control
 * such as a switch.
 */
function Row({
  htmlFor,
  icon,
  label,
  inline,
  children,
}: {
  htmlFor?: string
  icon: ReactNode
  label: ReactNode
  inline?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'sm:contents',
        inline ? 'flex items-center gap-2' : 'space-y-2 sm:space-y-0'
      )}
    >
      <Label htmlFor={htmlFor} className='flex items-center gap-2 sm:h-9'>
        {icon}
        {label}
      </Label>
      <div
        className={cn(
          'min-w-0',
          inline ? 'flex flex-1 items-center gap-2 sm:h-9' : 'space-y-2'
        )}
      >
        {children}
      </div>
    </div>
  )
}
