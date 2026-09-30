// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  DatePicker,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  TimePicker,
  TimezoneSelect,
  addDays,
  cn,
  getErrorMessage,
  naturalCompare,
  toast,
  useDiscardGuard,
  useFormat,
  useScreenSize,
} from '@mochi/web'
import {
  Bell,
  Check,
  Clock,
  Copy as CopyIcon,
  Globe,
  MapPin,
  Plus,
  Repeat as RepeatIcon,
  X,
} from 'lucide-react'
import type { Component } from '@/api/types/events'
import {
  copyDraft,
  formCopy,
  draftComponent,
  draftInstants,
  endAfterStart,
  startZone,
  expressible,
  foreignZones,
  emptyRepeat,
  masterComponent,
  movedStart,
  nextReminder,
  openedDraft,
  savedComponents,
  savedSplit,
  type EventDraft,
  type Frequency,
  type Scope,
} from '@/lib/ical'
import { useCalendarContext } from '@/context/calendar-context'
import {
  useCreateEventMutation,
  useEventQuery,
  useSplitEventMutation,
  useUpdateEventMutation,
} from '@/hooks/use-events'
import { reminderChoices } from '@/hooks/use-options'
import { DeleteEventDialog } from '@/features/calendar/components/delete-event-dialog'
import { ScopeDialog } from '@/features/calendar/components/scope-dialog'

const WEEKDAY_ANCHOR = '2024-01-07'

export function EventEditor() {
  const { t } = useLingui()
  const format = useFormat()
  const { isMobile } = useScreenSize()
  const { editing, setEditing, calendars, remember, reveal } =
    useCalendarContext()

  const editingEvent = editing?.mode === 'edit' ? editing.event : null
  const { data, isLoading, refetch } = useEventQuery(editingEvent)
  const event = data?.event

  const [draft, setDraft] = useState<EventDraft | null>(null)
  // The draft as the editor opened on it, so closing can tell whether
  // anything typed would be lost.
  const [initial, setInitial] = useState<EventDraft | null>(null)
  // The zone controls, revealed by the globe for the rest of one edit.
  const [revealed, setRevealed] = useState(false)
  const [custom, setCustom] = useState(false)
  const [asking, setAsking] = useState<'save' | 'copy' | null>(null)
  // A save tried without a title; the title row says so until one is typed.
  const [untitled, setUntitled] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const splitMutation = useSplitEventMutation()

  const writable = useMemo(
    () =>
      [...calendars]
        .filter((calendar) => !calendar.readonly)
        .sort((a, b) => {
          if (a.default !== b.default) return a.default ? -1 : 1
          return naturalCompare(a.name, b.name)
        }),
    [calendars]
  )

  // A create opens on the draft it was given; an edit waits for the stored
  // event, then reads the occurrence's own component where it has one.
  useEffect(() => {
    setRevealed(false)
    setUntitled(false)
    if (!editing) {
      setDraft(null)
      setInitial(null)
      setAsking(null)
      setConfirming(false)
      return
    }
    if (editing.mode === 'create') {
      setDraft(editing.draft)
      setInitial(editing.initial ?? editing.draft)
      setCustom(false)
      return
    }
    if (!event) return
    const read = openedDraft(
      event.components,
      editing.start,
      event.calendar,
      format.timezone,
      event.recurring
    )
    if (!read) return
    setDraft(read)
    setInitial(read)
    setCustom(
      read.repeat.interval > 1 ||
        read.repeat.weekdays.length > 0 ||
        read.repeat.ending !== 'never'
    )
  }, [editing, event, format.timezone])

  const close = () => setEditing(null)

  const recurring = Boolean(event?.recurring) && editing?.mode === 'edit'
  // Whether the form holds anything not yet saved: closing asks first, and a
  // copy carries it over.
  const changed =
    draft !== null &&
    initial !== null &&
    JSON.stringify(draft) !== JSON.stringify(initial)

  // The end may read earlier than the start by the clock, across zones, but
  // never as an instant.
  const ordered = draft
    ? draftInstants(draft).finish >= draftInstants(draft).start
    : true
  // The zones show only when an end is not in the user's zone, or on request.
  const zones = draft ? foreignZones(draft, format.timezone) || revealed : false

  const write = async (scope: Scope) => {
    if (!draft || !editing) return
    try {
      if (editing.mode === 'create') {
        await createMutation.mutateAsync({
          calendar: draft.calendar,
          components: [draftComponent(draft)],
        })
        remember(draft)
        reveal(draft.calendar)
        toast.success(editing.copy ? t`Event copied` : t`Event created`)
      } else {
        if (!event) return
        const master = masterComponent(event.components)
        // This occurrence and the ones after it become a series of their
        // own, starting where this one now falls. The first occurrence has
        // nothing before it, so that is the whole series.
        if (recurring && scope === 'following' && master) {
          const split = savedSplit(
            event.components,
            draft,
            editing.start,
            format.timezone
          )
          if (split) {
            await splitMutation.mutateAsync({
              event: event.id,
              etag: event.etag,
              start: editing.start,
              components: split.before,
              following: split.after,
              calendar: draft.calendar,
            })
            reveal(draft.calendar)
            toast.success(t`Event saved`)
            close()
            return
          }
          scope = 'all'
        }
        const components: Component[] = recurring
          ? savedComponents(
              event.components,
              draft,
              scope,
              editing.start,
              format.timezone
            )
          : [draftComponent(draft, master ?? undefined)]
        await updateMutation.mutateAsync({
          event: event.id,
          etag: event.etag,
          calendar: draft.calendar,
          components,
        })
        reveal(draft.calendar)
        toast.success(t`Event saved`)
      }
      close()
    } catch (error) {
      if ((error as { status?: number })?.status === 412) {
        toast.error(t`This event changed somewhere else.`, {
          action: {
            label: t`Reload`,
            onClick: () => void refetch(),
          },
        })
        return
      }
      toast.error(getErrorMessage(error, t`Failed to save the event`))
    }
  }

  // Save is refused only for a reason the form shows: no title, or an end
  // before the start, which the End row already says.
  const save = () => {
    if (!draft) return
    if (draft.title.trim() === '') {
      setUntitled(true)
      document.getElementById('event-title')?.focus()
      return
    }
    if (!ordered) return
    if (recurring) setAsking('save')
    else void write('all')
  }

  // A copy opens the editor again on a new event filled from this one, in
  // the calendar the form shows; a series asks which of it to copy.
  const duplicate = (scope: 'one' | 'all') => {
    if (!draft || !event || editing?.mode !== 'edit') return
    const stored = copyDraft(
      event.components,
      editing.start,
      draft.calendar,
      format.timezone,
      scope
    )
    if (!stored) return
    // Edits not yet saved go into the copy rather than being dropped; the
    // stored copy is what closing measures against, so it still asks.
    const copied = changed
      ? formCopy(
          draft,
          event.components,
          editing.start,
          format.timezone,
          scope,
          recurring
        )
      : stored
    setEditing({ mode: 'create', draft: copied, copy: true, initial: stored })
    // The form swaps in place, and its heading turning to "Copy event" is
    // what says so; the cursor goes to the title, since the button that was
    // clicked has gone with the Delete beside it.
    requestAnimationFrame(() => {
      const title = document.getElementById('event-title')
      if (title instanceof HTMLInputElement) {
        title.focus()
        title.select()
      }
    })
  }

  const copy = () => {
    if (recurring) setAsking('copy')
    else duplicate('one')
  }

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    splitMutation.isPending

  // Escape, a click outside, the X and Cancel all come through here: a form
  // with changes asks first, and nothing closes while a save is in flight.
  const { requestClose, discardDialog } = useDiscardGuard({
    hasText: changed,
    hasFiles: false,
    onDiscard: close,
    locked: pending,
    desc: t`Your changes will be lost.`,
  })

  const open = editing !== null
  const body =
    isLoading && editing?.mode === 'edit' && !draft ? (
      <div className='space-y-3 p-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-24 w-full' />
      </div>
    ) : draft ? (
      <EditorFields
        draft={draft}
        zones={zones}
        ordered={ordered}
        untitled={untitled && draft.title.trim() === ''}
        onReveal={() => setRevealed(true)}
        setDraft={setDraft}
        custom={custom}
        setCustom={setCustom}
        calendars={writable.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
        }))}
      />
    ) : null

  const footer = (
    <>
      {editing?.mode === 'edit' && (
        <>
          <Button
            variant='outline'
            onClick={() => setConfirming(true)}
            disabled={pending}
          >
            <Trans>Delete</Trans>
          </Button>
          <Button
            variant='outline'
            className='me-auto'
            onClick={copy}
            disabled={pending || !event}
          >
            <Trans>Copy</Trans>
          </Button>
        </>
      )}
      <Button variant='outline' onClick={requestClose} disabled={pending}>
        <Trans>Cancel</Trans>
      </Button>
      <Button
        onClick={save}
        loading={pending}
        disabled={!draft}
        icon={<Check className='size-4' />}
      >
        <Trans>Save</Trans>
      </Button>
    </>
  )

  const title =
    editing?.mode === 'create'
      ? editing.copy
        ? t`Copy event`
        : t`New event`
      : t`Edit event`

  return (
    <>
      {isMobile ? (
        open && (
          <div className='bg-background fixed inset-0 z-50 flex flex-col'>
            <div className='flex items-center gap-2 border-b px-4 py-3'>
              <Button
                variant='ghost'
                size='icon'
                onClick={requestClose}
                aria-label={t`Close`}
              >
                <X className='size-4' />
              </Button>
              <h1 className='text-base font-semibold'>{title}</h1>
            </div>
            <div className='min-h-0 flex-1 overflow-y-auto p-4'>{body}</div>
            <div className='flex items-center gap-2 border-t px-4 py-3'>
              {footer}
            </div>
          </div>
        )
      ) : (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) requestClose()
          }}
        >
          <DialogContent className='sm:max-w-[720px]'>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            {/* Tall enough for the whole form on an ordinary screen; the
                scroll only appears when the window is shorter than that. */}
            <div className='max-h-[80vh] overflow-y-auto pe-1'>{body}</div>
            <DialogFooter className='gap-2'>{footer}</DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ScopeDialog
        open={asking === 'save'}
        title={t`Save this event`}
        icon={<Check className='size-4' />}
        onOpenChange={(next) => {
          if (!next) setAsking(null)
        }}
        onChoose={(scope) => {
          setAsking(null)
          void write(scope)
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
          duplicate(scope === 'all' ? 'all' : 'one')
        }}
      />

      {discardDialog}

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
  zones,
  ordered,
  untitled,
  onReveal,
}: {
  draft: EventDraft
  setDraft: React.Dispatch<React.SetStateAction<EventDraft | null>>
  custom: boolean
  setCustom: (value: boolean) => void
  calendars: { id: string; name: string }[]
  /** Whether the zone controls show; a globe reveals them otherwise. */
  zones: boolean
  /** Whether the end follows the start as instants; Save waits for that. */
  ordered: boolean
  /** A save was tried without a title, which the title row says. */
  untitled: boolean
  onReveal: () => void
}) {
  const { t } = useLingui()
  const format = useFormat()

  // A rule read from the event that the repeat settings cannot express is
  // shown as custom and written back as it was.
  const kept = !expressible(draft.repeat.rule)

  // The fields only render with a draft in hand, so an update never has to
  // answer for the null the editor starts in.
  const edit = (update: (current: EventDraft) => EventDraft) =>
    setDraft((current) => (current ? update(current) : current))

  const moveStart = (day: string, minutes: number) =>
    edit((current) => movedStart(current, day, minutes))

  const weekdays = useMemo(() => {
    const out: { day: number; label: string }[] = []
    for (let offset = 0; offset < 7; offset++) {
      const day = (format.weekStartsOn + offset) % 7
      const at = format.timestampAt(addDays(WEEKDAY_ANCHOR, day), 720)
      out.push({ day, label: format.formatWeekdayShort(new Date(at * 1000)) })
    }
    return out
  }, [format])

  return (
    <div className='space-y-4 px-1'>
      <div className='space-y-2'>
        <Label htmlFor='event-title'>
          <Trans>Title</Trans>
        </Label>
        <Input
          id='event-title'
          value={draft.title}
          autoFocus
          aria-invalid={untitled || undefined}
          onChange={(input) =>
            edit((current) => ({ ...current, title: input.target.value }))
          }
        />
        {untitled && (
          <p className='text-destructive text-xs' data-testid='untitled'>
            {t`Title is required`}
          </p>
        )}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='event-calendar'>
          <Trans>Calendar</Trans>
        </Label>
        <Select
          value={draft.calendar}
          onValueChange={(value) =>
            edit((current) => ({ ...current, calendar: value }))
          }
        >
          <SelectTrigger id='event-calendar' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {calendars.map((calendar) => (
              <SelectItem key={calendar.id} value={calendar.id}>
                {calendar.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='flex items-center justify-between rounded-lg border px-4 py-3'>
        <Label htmlFor='event-allday' className='flex items-center gap-2'>
          <Clock className='size-4' />
          <Trans>All day</Trans>
        </Label>
        <Switch
          id='event-allday'
          checked={draft.allday}
          onCheckedChange={(value) =>
            edit((current) => ({ ...current, allday: value }))
          }
        />
      </div>

      {/* One above the other on a phone: side by side, the 128px time
          pickers leave the dates no room. */}
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='event-start'>
            <Trans>Start</Trans>
          </Label>
          <div className='flex gap-2'>
            <DatePicker
              id='event-start'
              className='min-w-0 flex-1'
              value={draft.start}
              onChange={(day) => moveStart(day || draft.start, draft.startTime)}
            />
            {!draft.allday && (
              <TimePicker
                className='w-32 shrink-0'
                aria-label={t`Start time`}
                value={draft.startTime}
                onChange={(minutes) => moveStart(draft.start, minutes)}
              />
            )}
          </div>
          {zones && (
            <TimezoneSelect
              compact
              auto={false}
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
        <div className='space-y-2'>
          <Label htmlFor='event-finish'>
            <Trans>End</Trans>
          </Label>
          <div className='flex gap-2'>
            <DatePicker
              id='event-finish'
              className='min-w-0 flex-1'
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
                className='w-32 shrink-0'
                aria-label={t`End time`}
                value={draft.finishTime}
                onChange={(minutes) =>
                  edit((current) => ({ ...current, finishTime: minutes }))
                }
              />
            )}
            {!draft.allday && !zones && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-muted-foreground shrink-0'
                aria-label={t`Time zone`}
                onClick={onReveal}
              >
                <Globe className='size-4' />
              </Button>
            )}
          </div>
          {zones && (
            <TimezoneSelect
              compact
              auto={false}
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
          {/* Save waits for an end that follows the start; the row says why. */}
          {!ordered && (
            <p className='text-destructive text-xs' data-testid='backwards'>
              {t`Ends before it starts`}
            </p>
          )}
        </div>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='event-location' className='flex items-center gap-2'>
          <MapPin className='size-4' />
          <Trans>Location</Trans>
        </Label>
        <Input
          id='event-location'
          value={draft.location}
          onChange={(input) =>
            edit((current) => ({
              ...current,
              location: input.target.value,
            }))
          }
        />
      </div>

      <div className='space-y-2'>
        <Label htmlFor='event-repeat' className='flex items-center gap-2'>
          <RepeatIcon className='size-4' />
          <Trans>Repeat</Trans>
        </Label>
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
            <SelectItem value='never'>{t`Never`}</SelectItem>
            <SelectItem value='daily'>{t`Daily`}</SelectItem>
            <SelectItem value='weekly'>{t`Weekly`}</SelectItem>
            <SelectItem value='monthly'>{t`Monthly`}</SelectItem>
            <SelectItem value='yearly'>{t`Yearly`}</SelectItem>
            <SelectItem value='custom'>{t`Custom`}</SelectItem>
          </SelectContent>
        </Select>
        {/* A rule the settings cannot express is kept as written; choosing
            a repeat replaces it. */}
        {kept && (
          <p className='text-muted-foreground text-xs' data-testid='kept-rule'>
            {draft.repeat.rule}
          </p>
        )}
      </div>

      {custom && !kept && (
        <div className='space-y-3 rounded-lg border p-3'>
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
              <Input
                id='repeat-interval'
                type='number'
                min={1}
                max={366}
                value={draft.repeat.interval}
                onChange={(input) =>
                  edit((current) => ({
                    ...current,
                    repeat: {
                      ...current.repeat,
                      rule: '',
                      interval: Math.max(1, Number(input.target.value) || 1),
                    },
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
                  <SelectItem value='never'>{t`Never`}</SelectItem>
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
                  onChange={(day) =>
                    edit((current) => ({
                      ...current,
                      repeat: {
                        ...current.repeat,
                        rule: '',
                        until: day,
                      },
                    }))
                  }
                />
              </div>
            )}
            {draft.repeat.ending === 'count' && (
              <div className='space-y-2'>
                <Label htmlFor='repeat-count'>
                  <Trans>Occurrences</Trans>
                </Label>
                <Input
                  id='repeat-count'
                  type='number'
                  min={1}
                  max={999}
                  value={draft.repeat.count}
                  onChange={(input) =>
                    edit((current) => ({
                      ...current,
                      repeat: {
                        ...current.repeat,
                        rule: '',
                        count: Math.max(1, Number(input.target.value) || 1),
                      },
                    }))
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className='space-y-2'>
        <Label htmlFor='event-reminder' className='flex items-center gap-2'>
          <Bell className='size-4' />
          <Trans>Reminder</Trans>
        </Label>
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
      </div>

      <div className='space-y-2'>
        <Label htmlFor='event-description'>
          <Trans>Description</Trans>
        </Label>
        <Textarea
          id='event-description'
          rows={3}
          value={draft.description}
          onChange={(input) =>
            edit((current) => ({
              ...current,
              description: input.target.value,
            }))
          }
        />
      </div>
    </div>
  )
}
