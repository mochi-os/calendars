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
  TimezoneSelect,
  addDays,
  cn,
  daysBetween,
  getErrorMessage,
  naturalCompare,
  toast,
  useFormat,
  useScreenSize,
} from '@mochi/web'
import {
  Bell,
  Check,
  Clock,
  Globe,
  MapPin,
  Repeat as RepeatIcon,
  X,
} from 'lucide-react'
import type { Component } from '@/api/types/events'
import {
  anchoredDraft,
  componentDraft,
  draftComponent,
  draftInstants,
  editedComponents,
  foreignZones,
  emptyRepeat,
  masterComponent,
  overrideComponent,
  splitSeries,
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
import { reminderOptions } from '@/hooks/use-options'
import { DeleteEventDialog } from '@/features/calendar/components/delete-event-dialog'
import { ScopeDialog } from '@/features/calendar/components/scope-dialog'

const WEEKDAY_ANCHOR = '2024-01-07'

export function EventEditor() {
  const { t } = useLingui()
  const format = useFormat()
  const { isMobile } = useScreenSize()
  const { editing, setEditing, calendars } = useCalendarContext()

  const editingEvent = editing?.mode === 'edit' ? editing.event : null
  const { data, isLoading, refetch } = useEventQuery(editingEvent)
  const event = data?.event

  const [draft, setDraft] = useState<EventDraft | null>(null)
  // The zone controls, revealed by the globe for the rest of one edit.
  const [revealed, setRevealed] = useState(false)
  const [custom, setCustom] = useState(false)
  const [asking, setAsking] = useState<'save' | 'delete' | null>(null)
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
    if (!editing) {
      setDraft(null)
      setAsking(null)
      setConfirming(false)
      return
    }
    if (editing.mode === 'create') {
      setDraft(editing.draft)
      setCustom(false)
      return
    }
    if (!event) return
    const own =
      overrideComponent(event.components, editing.start, format.timezone) ??
      masterComponent(event.components)
    if (!own) return
    const read = componentDraft(own, event.calendar, format.timezone)
    setDraft(read)
    setCustom(
      read.repeat.interval > 1 ||
        read.repeat.weekdays.length > 0 ||
        read.repeat.ending !== 'never'
    )
  }, [editing, event, format.timezone])

  const close = () => setEditing(null)

  const recurring = Boolean(event?.recurring) && editing?.mode === 'edit'
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
        toast.success(t`Event created`)
      } else {
        if (!event) return
        const master = masterComponent(event.components)
        // This occurrence and the ones after it become a series of their
        // own, starting where this one now falls. The first occurrence has
        // nothing before it, so that is the whole series.
        if (recurring && scope === 'following' && master) {
          const fromMaster = !overrideComponent(
            event.components,
            editing.start,
            format.timezone
          )
          const split = splitSeries(
            event.components,
            anchoredDraft(
              draft,
              master,
              editing.start,
              format.timezone,
              fromMaster
            ),
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
            toast.success(t`Event saved`)
            close()
            return
          }
          scope = 'all'
        }
        const components: Component[] = recurring
          ? editedComponents(
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

  const save = () => {
    if (!draft || draft.title.trim() === '') return
    if (recurring) setAsking('save')
    else void write('all')
  }

  const pending =
    createMutation.isPending ||
    updateMutation.isPending ||
    splitMutation.isPending

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
        <Button
          variant='outline'
          className='me-auto'
          onClick={() => setConfirming(true)}
          disabled={pending}
        >
          <Trans>Delete</Trans>
        </Button>
      )}
      <Button variant='outline' onClick={close} disabled={pending}>
        <Trans>Cancel</Trans>
      </Button>
      <Button
        onClick={save}
        loading={pending}
        disabled={!draft || draft.title.trim() === '' || !ordered}
        icon={<Check className='size-4' />}
      >
        <Trans>Save</Trans>
      </Button>
    </>
  )

  const title = editing?.mode === 'create' ? t`New event` : t`Edit event`

  return (
    <>
      {isMobile ? (
        open && (
          <div className='bg-background fixed inset-0 z-50 flex flex-col'>
            <div className='flex items-center gap-2 border-b px-4 py-3'>
              <Button
                variant='ghost'
                size='icon'
                onClick={close}
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
            if (!next) close()
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
  onReveal,
}: {
  draft: EventDraft
  setDraft: React.Dispatch<React.SetStateAction<EventDraft | null>>
  custom: boolean
  setCustom: (value: boolean) => void
  calendars: { id: string; name: string }[]
  /** Whether the zone controls show; a globe reveals them otherwise. */
  zones: boolean
  onReveal: () => void
}) {
  const { t } = useLingui()
  const format = useFormat()
  const reminders = reminderOptions()

  // The fields only render with a draft in hand, so an update never has to
  // answer for the null the editor starts in.
  const edit = (update: (current: EventDraft) => EventDraft) =>
    setDraft((current) => (current ? update(current) : current))

  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60
    ).padStart(2, '0')}`

  const minutesOf = (value: string) => {
    const [hour, minute] = value.split(':').map(Number)
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
    return hour * 60 + minute
  }

  // Moving the start carries the end with it, which is what every calendar
  // does: the length the user set is the thing worth keeping.
  const moveStart = (day: string, minutes: number) => {
    edit((current) => {
      const shiftDays = daysBetween(current.start, day)
      const shiftMinutes = minutes - current.startTime
      return {
        ...current,
        start: day,
        startTime: minutes,
        finish: addDays(current.finish, shiftDays),
        finishTime: Math.max(
          0,
          Math.min(1439, current.finishTime + shiftMinutes)
        ),
      }
    })
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
          onChange={(input) =>
            edit((current) => ({ ...current, title: input.target.value }))
          }
        />
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

      <div className='grid grid-cols-2 gap-3'>
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
              <Input
                type='time'
                className='w-auto shrink-0'
                aria-label={t`Start time`}
                value={clock(draft.startTime)}
                onChange={(input) =>
                  moveStart(draft.start, minutesOf(input.target.value))
                }
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
                // The end follows the start while the two still agree.
                edit((current) => ({
                  ...current,
                  zone: {
                    start: zone,
                    finish:
                      current.zone.finish === current.zone.start
                        ? zone
                        : current.zone.finish,
                  },
                }))
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
              <Input
                type='time'
                className='w-auto shrink-0'
                aria-label={t`End time`}
                value={clock(draft.finishTime)}
                onChange={(input) =>
                  edit((current) => ({
                    ...current,
                    finishTime: minutesOf(input.target.value),
                  }))
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
                edit((current) => ({
                  ...current,
                  zone: { ...current.zone, finish: zone },
                }))
              }
            />
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
          value={custom ? 'custom' : draft.repeat.frequency}
          onValueChange={(value) => {
            if (value === 'custom') {
              setCustom(true)
              edit((current) => ({
                ...current,
                repeat: {
                  ...current.repeat,
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
      </div>

      {custom && (
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
        <Select
          value={String(draft.reminder)}
          onValueChange={(value) =>
            edit((current) => ({ ...current, reminder: Number(value) }))
          }
        >
          <SelectTrigger id='event-reminder' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {reminders.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
