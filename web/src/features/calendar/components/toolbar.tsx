// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  cn,
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
  const { isDesktop, isMobile } = useScreenSize()
  const {
    view,
    setView,
    date,
    setDate,
    listed,
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
  // Below tablet width (768px) there is no room for a grid, so only the two
  // views that read well in a column are offered.
  const offered = !isMobile
    ? options
    : options.filter(
        (option) => option.value === 'day' || option.value === 'list'
      )

  // The list is named after, and steps on from, the day it has scrolled to.
  const shown = listed ?? date
  const step = (direction: number) =>
    setDate(stepDate(view, shown, direction))

  // A day read at its noon, so the user's zone cannot tip it into the next.
  const dated = (day: string) =>
    format.formatDate(new Date(format.timestampAt(day, 720) * 1000))
  // The dates in the user's date format; a month names only itself.
  const title = rangeTitle(view, { ...range, date: shown }, {
    longDate: dated,
    monthYear: (day) =>
      format.formatMonthYear(new Date(format.timestampAt(day, 720) * 1000)),
    dayRange: (first, last) => {
      const from = dated(first)
      const to = dated(last)
      return t`${from} – ${to}`
    },
  })

  const nav = (
    <div className='flex shrink-0 items-center'>
      <Button
        variant='ghost'
        size='icon'
        aria-label={t`Previous`}
        onClick={() => step(-1)}
      >
        <ChevronLeft className='size-4 rtl:rotate-180' />
      </Button>
      <Button variant='outline' size='sm' onClick={() => setDate(today)}>
        <CalendarCheck className='size-4' />
        {t`Today`}
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
  )

  const heading = isDesktop ? (
    <h1 className='min-w-0 flex-1 basis-full truncate text-sm font-medium lg:basis-auto'>
      {title}
    </h1>
  ) : (
    <Popover>
      <PopoverTrigger asChild>
        {/* On a tablet the title takes a row of its own; on a phone it
            shares the first row with the arrows. */}
        <Button
          variant='ghost'
          className={cn(
            'min-w-0 flex-1 justify-start text-sm font-medium',
            !isMobile && 'basis-full'
          )}
        >
          <span className='truncate'>{title}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-72'>
        <MiniMonth selected={shown} today={today} onSelect={setDate} />
      </PopoverContent>
    </Popover>
  )

  // The search box: the list view filters by it, and typing from any other
  // view opens the list, which is where the matches show.
  const searchBox = (
    <div className={cn('relative', isMobile ? 'min-w-0 flex-1' : 'ms-auto')}>
      <Search
        className='text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2'
        aria-hidden
      />
      <Input
        id='calendar-search'
        type='search'
        aria-label={t`Search`}
        placeholder={t`Search events`}
        className={cn('h-9 ps-8', isMobile ? 'w-full' : 'w-36 sm:w-52')}
        value={search}
        onChange={(input) => {
          const value = input.target.value
          setSearch(value)
          if (value.trim() && view !== 'list') setView('list')
        }}
      />
    </div>
  )

  const picker = (
    <Select
      value={view}
      onValueChange={(value) => setView(value as CalendarView)}
    >
      <SelectTrigger className='w-auto shrink-0' aria-label={t`View`}>
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
  )

  // A phone keeps the toolbar to two rows: where you are, then what to do.
  if (isMobile) {
    return (
      <div className='flex flex-col gap-2 border-b px-3 py-2'>
        <div className='flex min-w-0 items-center gap-1'>
          {nav}
          {heading}
        </div>
        <div className='flex items-center gap-2'>
          {searchBox}
          {picker}
          <Button
            size='icon'
            className='shrink-0'
            aria-label={t`New event`}
            onClick={onCreate}
          >
            <Plus className='size-4' />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
      {nav}
      {heading}
      {searchBox}
      {picker}

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
