// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  DropdownMenu,
  Input,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MiniMonth,
  Popover,
  PopoverContent,
  PopoverTrigger,
  rangeTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  stepDate,
  useFormat,
  useScreenSize,
  type CalendarView,
} from '@mochi/web'
import {
  Calendar,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid3x3,
  List,
  MoreHorizontal,
  Plus,
  Rows3,
  Search,
} from 'lucide-react'
import { useCalendarContext } from '@/context/calendar-context'

export function Toolbar({ onCreate }: { onCreate: () => void }) {
  const { t } = useLingui()
  const format = useFormat()
  const { isDesktop } = useScreenSize()
  const {
    view,
    setView,
    date,
    setDate,
    today,
    range,
    workweek,
    setWorkweek,
    search,
    setSearch,
  } = useCalendarContext()

  const options: {
    value: CalendarView
    label: string
    icon: React.ElementType
  }[] = [
    { value: 'day', label: t`Day`, icon: Calendar },
    { value: 'week', label: t`Week`, icon: Columns3 },
    { value: 'multiweek', label: t`Multiweek`, icon: Rows3 },
    { value: 'month', label: t`Month`, icon: Grid3x3 },
    { value: 'list', label: t`List`, icon: List },
  ]
  // Below tablet width there is no room for a grid, so only the two views that
  // read well in a column are offered.
  const offered = isDesktop
    ? options
    : options.filter(
        (option) => option.value === 'day' || option.value === 'list'
      )

  const step = (direction: number) => setDate(stepDate(view, date, direction))

  const title = rangeTitle(view, range, {
    longDate: (day) =>
      format.formatLongDate(new Date(format.timestampAt(day, 720) * 1000)),
    monthYear: (day) =>
      format.formatMonthYear(new Date(format.timestampAt(day, 720) * 1000)),
    dayRange: (from, to) =>
      format.formatDayRange(
        new Date(format.timestampAt(from, 720) * 1000),
        new Date(format.timestampAt(to, 720) * 1000)
      ),
  })

  return (
    <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
      <Button variant='outline' size='sm' onClick={() => setDate(today)}>
        <CalendarCheck className='size-4' />
        {t`Today`}
      </Button>
      <div className='flex items-center'>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t`Previous`}
          onClick={() => step(-1)}
        >
          <ChevronLeft className='size-4 rtl:rotate-180' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          aria-label={t`Next`}
          onClick={() => step(1)}
        >
          <ChevronRight className='size-4 rtl:rotate-180' />
        </Button>
      </div>

      {isDesktop ? (
        <h1 className='min-w-0 flex-1 basis-full truncate text-base font-semibold lg:basis-auto'>
          {title}
        </h1>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant='ghost'
              className='min-w-0 flex-1 basis-full justify-start truncate text-base font-semibold'
            >
              {title}
            </Button>
          </PopoverTrigger>
          <PopoverContent align='start' className='w-72'>
            <MiniMonth selected={date} today={today} onSelect={setDate} />
          </PopoverContent>
        </Popover>
      )}

      {/* The search box: the list view filters by it, and typing from any
          other view opens the list, which is where the matches show. */}
      <div className='relative ms-auto'>
        <Search
          className='text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2'
          aria-hidden
        />
        <Input
          type='search'
          aria-label={t`Search`}
          className='h-9 w-36 ps-8 sm:w-52'
          value={search}
          onChange={(input) => {
            const value = input.target.value
            setSearch(value)
            if (value.trim() && view !== 'list') setView('list')
          }}
        />
      </div>

      <Select
        value={view}
        onValueChange={(value) => setView(value as CalendarView)}
      >
        <SelectTrigger className='w-auto' aria-label={t`View`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align='end'>
          {offered.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className='flex items-center gap-2'>
                <option.icon className='size-4' />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {view === 'week' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' aria-label={t`View options`}>
              <MoreHorizontal className='size-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuCheckboxItem
              checked={workweek}
              onCheckedChange={setWorkweek}
            >
              {t`Work week`}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button size='sm' onClick={onCreate} icon={<Plus className='size-4' />}>
        {t`New event`}
      </Button>
    </div>
  )
}
