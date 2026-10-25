// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  cn,
  DropdownMenu,
  Input,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MiniMonth,
  Popover,
  PopoverContent,
  PopoverTrigger,
  rangeTitle,
  stepDate,
  useFormat,
  useScreenSize,
  type CalendarView,
} from '@mochi/web'
import {
  Calendar,
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Grid3x3,
  List,
  Plus,
  Rows3,
  Search,
} from 'lucide-react'
import { useCalendarContext } from '@/context/calendar-context'

export function Toolbar({ onCreate }: { onCreate: () => void }) {
  const { t } = useLingui()
  const format = useFormat()
  const { isMobile } = useScreenSize()
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

  // Wider screens keep the search to an icon until it is wanted, and keep it
  // open while it holds a term; a phone always shows the field.
  const [searching, setSearching] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const collapsed = !isMobile && !searching && !search
  useEffect(() => {
    if (searching) field.current?.focus()
  }, [searching])
  // Escape closes the field and gives focus back to the icon it opened from.
  useEffect(() => {
    if (collapsed && refocus.current) {
      refocus.current = false
      opener.current?.focus()
    }
  }, [collapsed])

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
  const current = options.find((option) => option.value === view) ?? options[0]

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

  // The title names the range and opens a month to pick a day from. Only a
  // phone cuts it short; a wider screen moves the actions to a second row
  // first.
  const heading = (
    <h1 className={cn('flex-1 text-sm font-medium', isMobile && 'min-w-0')}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant='ghost'
            className='max-w-full justify-start text-sm font-medium'
          >
            <span className='min-w-0 truncate'>{title}</span>
            <ChevronDown className='size-4 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-72'>
          <MiniMonth selected={shown} today={today} onSelect={setDate} />
        </PopoverContent>
      </Popover>
    </h1>
  )

  // The search box: the list view filters by it, and typing from any other
  // view opens the list, which is where the matches show.
  const searchBox = collapsed ? (
    <Button
      ref={opener}
      id='calendar-search'
      variant='ghost'
      size='icon'
      className='shrink-0'
      aria-label={t`Search`}
      onClick={() => setSearching(true)}
    >
      <Search className='size-4' />
    </Button>
  ) : (
    <div className={cn('relative', isMobile && 'min-w-0 flex-1')}>
      <Search
        className='text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2'
        aria-hidden
      />
      <Input
        ref={field}
        id='calendar-search'
        type='search'
        aria-label={t`Search`}
        placeholder={t`Search events`}
        className={cn('h-9 ps-8', isMobile ? 'w-full' : 'w-36 lg:w-52')}
        value={search}
        onChange={(input) => {
          const value = input.target.value
          setSearch(value)
          if (value.trim() && view !== 'list') setView('list')
        }}
        onBlur={() => {
          if (!search.trim()) setSearching(false)
        }}
        onKeyDown={(key) => {
          if (key.key !== 'Escape') return
          setSearch('')
          setSearching(false)
          refocus.current = !isMobile
        }}
      />
    </div>
  )

  // The view, and in the week view whether it shows the work week only.
  const picker = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className='shrink-0'>
          <span className='sr-only'>{t`View`}</span>
          <current.icon className='size-4' />
          {current.label}
          <ChevronDown className='size-4 opacity-50' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(value) => setView(value as CalendarView)}
        >
          {offered.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className='size-4' />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {view === 'week' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={workweek}
              onCheckedChange={setWorkweek}
            >
              {t`Work week`}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const create = (
    <Button
      variant='ghost'
      size='icon'
      className='shrink-0'
      aria-label={t`New event`}
      onClick={onCreate}
    >
      <Plus className='size-4' />
    </Button>
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
          {create}
        </div>
      </div>
    )
  }

  // Where you are on the left, what to do on the right, on one row while
  // it fits; the actions take a second row rather than cut the title short.
  return (
    <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
      {nav}
      {heading}
      <div className='ms-auto flex items-center gap-2'>
        {searchBox}
        {picker}
        {create}
      </div>
    </div>
  )
}
