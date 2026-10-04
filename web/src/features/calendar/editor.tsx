// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  DatePicker,
  Button,
  ColourPicker,
  ConfirmDialog,
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
  GeneralError,
  getErrorMessage,
  toast,
  useDiscardGuard,
  useFormat,
  useLeaveGuard,
  useScreenSize,
} from '@mochi/web'
import {
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  Copy as CopyIcon,
  Palette,
  Plus,
  Repeat as RepeatIcon,
  Trash2,
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
  const { isMobile } = useScreenSize()
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
  // The draft as the editor opened on it, so closing can tell whether
  // anything typed would be lost.
  const [initial, setInitial] = useState<EventDraft | null>(null)
  const [custom, setCustom] = useState(false)
  const [asking, setAsking] = useState<'save' | 'copy' | null>(null)
  // A save tried without a title; the title row says so until one is typed.
  const [untitled, setUntitled] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const createMutation = useCreateEventMutation()
  const updateMutation = useUpdateEventMutation()
  const splitMutation = useSplitEventMutation()
  const moveOccurrence = useOccurrenceMove()

  const writable = useMemo(
    () => listed.filter((calendar) => !calendar.readonly),
    [listed]
  )

  // Which opening the form was last read for. A refetch while the editor is
  // open, the event having changed elsewhere, leaves the user's edits alone:
  // saving over it is refused and says so, and Reload reads it again.
  const seeded = useRef<typeof editing>(null)

  // A create opens on the draft it was given; an edit waits for the stored
  // event, then reads the occurrence's own component where it has one.
  useEffect(() => {
    if (!editing) {
      seeded.current = null
      setUntitled(false)
      setDraft(null)
      setInitial(null)
      setAsking(null)
      setConfirming(false)
      return
    }
    if (seeded.current === editing) return
    setUntitled(false)
    if (editing.mode === 'create') {
      seeded.current = editing
      setDraft(editing.draft)
      setInitial(editing.initial ?? editing.draft)
      setCustom(customised(editing.draft.repeat))
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
    seeded.current = editing
    setDraft(read)
    setInitial(read)
    setCustom(customised(read.repeat))
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
        // One occurrence taken to another calendar leaves the series behind
        // and becomes an event of its own there.
        if (leavesSeries(recurring, scope, event.calendar, draft.calendar)) {
          await moveOccurrence(
            event,
            editing.start,
            draft,
            draft.calendar,
            format.timezone
          )
          reveal(draft.calendar)
          toast.success(t`Event saved`)
          close()
          return
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
            onClick: () => {
              seeded.current = null
              void refetch()
            },
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

  // Escape, the X and Cancel all come through here: a form with changes asks
  // first, and nothing closes while a save is in flight. A click outside does
  // nothing at all, as in every other dialog that holds typed input.
  const { requestClose, discardDialog } = useDiscardGuard({
    hasText: changed,
    hasFiles: false,
    onDiscard: close,
    locked: pending,
    desc: t`Your changes will be lost.`,
  })

  const open = editing !== null

  // The shell's back, forward and cross-app links take the page, and the
  // editor with it, without the dialog closing first, so while the form holds
  // a change they ask the question closing does. Discarding closes the editor
  // too: it sits in the layout, which a move within the app keeps.
  const leaving = useLeaveGuard(open && changed)

  const body =
    isError && editing?.mode === 'edit' && !draft ? (
      <GeneralError
        mode='inline'
        className='my-4'
        error={error}
        reset={() => void refetch()}
      />
    ) : isLoading && editing?.mode === 'edit' && !draft ? (
      <div className='space-y-3 p-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-24 w-full' />
      </div>
    ) : draft ? (
      <EditorFields
        draft={draft}
        ordered={ordered}
        untitled={untitled && draft.title.trim() === ''}
        onSave={() => {
          if (!pending) save()
        }}
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
      {/* A phone's header X already closes, and four buttons do not fit
          across one. */}
      {!isMobile && (
        <Button variant='outline' onClick={requestClose} disabled={pending}>
          <Trans>Cancel</Trans>
        </Button>
      )}
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
          <DialogContent
            className='sm:max-w-[720px]'
            onInteractOutside={(outside) => outside.preventDefault()}
          >
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

      <ConfirmDialog
        open={leaving.asking}
        onOpenChange={(next) => {
          if (!next) leaving.stay()
        }}
        title={t`Discard draft?`}
        desc={t`Your changes will be lost.`}
        confirmText={t`Discard`}
        icon={<Trash2 className='size-4' />}
        destructive
        handleConfirm={() => {
          leaving.proceed()
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

/** An end's zone beside its time: the time's width, so long city names cut short. */
const ZONED = 'w-32 shrink-0'

/**
 * An all-day event's room where a timed one has its time and zone, so turning
 * All day on hides them without moving the dates. Where the row is narrower
 * than its date's least width, the time and the zone (9 + 8 + 8 rem and two
 * gaps, 26 rem), the zone wraps under the time, and its room goes rather than
 * leave an empty line.
 */
function Timeless() {
  return (
    <>
      <span aria-hidden className={TIMED} data-testid='time-room' />
      <span
        aria-hidden
        className={cn(ZONED, '@max-[26rem]:hidden')}
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
        inline ? 'flex items-center justify-between' : 'space-y-2 sm:space-y-0'
      )}
    >
      <Label htmlFor={htmlFor} className='flex items-center gap-2 sm:h-9'>
        {icon}
        {label}
      </Label>
      <div
        className={cn(
          'min-w-0',
          inline ? 'flex items-center sm:h-9' : 'space-y-2'
        )}
      >
        {children}
      </div>
    </div>
  )
}
