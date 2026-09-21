// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  Button,
  Label,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  addDays,
  cn,
  getErrorMessage,
  toastAction,
  useFormat,
} from '@mochi/web'
import { Check } from 'lucide-react'
import type { Preferences } from '@/api/types/preferences'
import {
  DEFAULTS,
  usePreferencesQuery,
  useSetPreferencesMutation,
} from '@/hooks/use-preferences'
import {
  durationOptions,
  reminderOptions,
  useHourOptions,
} from '@/hooks/use-options'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PreferencesDialog({ open, onOpenChange }: Props) {
  const { t } = useLingui()
  const format = useFormat()
  const { data, isLoading, isError, error } = usePreferencesQuery()
  const setPreferences = useSetPreferencesMutation()
  const [values, setValues] = useState<Preferences>(DEFAULTS)

  useEffect(() => {
    if (data?.preferences) setValues(data.preferences)
  }, [data?.preferences])

  const stored = data?.preferences
  const changed = useMemo(
    () => (stored ? JSON.stringify(stored) !== JSON.stringify(values) : false),
    [stored, values]
  )

  const startHours = useHourOptions(0, 23)
  const finishHours = useHourOptions(1, 24)
  const durations = durationOptions()
  const reminders = reminderOptions()

  // Weekdays in the order the user's own week runs.
  const weekdays = useMemo(() => {
    const out: { day: number; label: string }[] = []
    for (let offset = 0; offset < 7; offset++) {
      const day = (format.weekStartsOn + offset) % 7
      // 2024-01-07 was a Sunday, so day 0 sits exactly there.
      const at = format.timestampAt(addDays('2024-01-07', day), 720)
      out.push({
        day,
        label: format.formatWeekdayShort(new Date(at * 1000)),
      })
    }
    return out
  }, [format])

  const save = async () => {
    try {
      await toastAction(setPreferences.mutateAsync(values), {
        loading: t`Saving...`,
        success: t`Preferences saved`,
        error: (failure) => getErrorMessage(failure, t`Failed to save`),
      })
      onOpenChange(false)
    } catch {
      // toastAction already showed error
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className='sm:max-w-[520px]'>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <Trans>Preferences</Trans>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {isLoading ? (
          <div className='space-y-3 px-4 py-2 sm:px-0'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </div>
        ) : isError ? (
          <p className='text-destructive px-4 py-2 text-sm sm:px-0'>
            {getErrorMessage(error, t`Failed to load your preferences`)}
          </p>
        ) : (
          <div className='space-y-4 px-4 pb-4 sm:px-0 sm:pb-0'>
            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='hours-start'>
                  <Trans>Working hours start</Trans>
                </Label>
                <NumberSelect
                  id='hours-start'
                  value={values.hours.start}
                  options={startHours}
                  onChange={(hour) =>
                    setValues((current) => ({
                      ...current,
                      hours: {
                        start: hour,
                        finish: Math.max(current.hours.finish, hour + 1),
                      },
                    }))
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='hours-finish'>
                  <Trans>Working hours end</Trans>
                </Label>
                <NumberSelect
                  id='hours-finish'
                  value={values.hours.finish}
                  options={finishHours.filter(
                    (option) => option.value > values.hours.start
                  )}
                  onChange={(hour) =>
                    setValues((current) => ({
                      ...current,
                      hours: { ...current.hours, finish: hour },
                    }))
                  }
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label>
                <Trans>Work days</Trans>
              </Label>
              <div className='flex flex-wrap gap-1'>
                {weekdays.map((weekday) => {
                  const on = values.days.includes(weekday.day)
                  return (
                    <button
                      key={weekday.day}
                      type='button'
                      aria-pressed={on}
                      onClick={() =>
                        setValues((current) => ({
                          ...current,
                          days: on
                            ? current.days.filter((day) => day !== weekday.day)
                            : [...current.days, weekday.day].sort(),
                        }))
                      }
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm',
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
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label htmlFor='multiweek-weeks'>
                  <Trans>Weeks shown</Trans>
                </Label>
                <NumberSelect
                  id='multiweek-weeks'
                  value={values.multiweek.weeks}
                  options={[2, 3, 4, 5, 6, 7, 8].map((weeks) => ({
                    value: weeks,
                    label: format.formatNumber(weeks),
                  }))}
                  onChange={(weeks) =>
                    setValues((current) => ({
                      ...current,
                      multiweek: { ...current.multiweek, weeks },
                    }))
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='multiweek-previous'>
                  <Trans>Weeks before</Trans>
                </Label>
                <NumberSelect
                  id='multiweek-previous'
                  value={values.multiweek.previous}
                  options={[0, 1, 2].map((weeks) => ({
                    value: weeks,
                    label: format.formatNumber(weeks),
                  }))}
                  onChange={(previous) =>
                    setValues((current) => ({
                      ...current,
                      multiweek: { ...current.multiweek, previous },
                    }))
                  }
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='default-duration'>
                <Trans>Default event length</Trans>
              </Label>
              <NumberSelect
                id='default-duration'
                value={values.duration}
                options={durations}
                onChange={(duration) =>
                  setValues((current) => ({ ...current, duration }))
                }
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='default-reminder'>
                <Trans>Default reminder</Trans>
              </Label>
              <NumberSelect
                id='default-reminder'
                value={values.reminder}
                options={reminders}
                onChange={(reminder) =>
                  setValues((current) => ({ ...current, reminder }))
                }
              />
            </div>
          </div>
        )}

        <ResponsiveDialogFooter className='gap-2'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={setPreferences.isPending}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={() => void save()}
            disabled={isLoading || isError || !changed}
            loading={setPreferences.isPending}
            icon={<Check className='size-4' />}
          >
            <Trans>Save</Trans>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function NumberSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: number
  options: { value: number; label: string }[]
  onChange: (value: number) => void
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger id={id} className='w-full'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
