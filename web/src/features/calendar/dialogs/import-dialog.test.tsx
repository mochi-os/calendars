// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Calendar, ImportResponse } from '@/api/types/calendars'
import { ImportDialog } from './import-dialog'

const calendar = { id: 'c1', name: 'Work' } as Calendar

const state = vi.hoisted(() => ({
  // Every request as the request layer receives it, and the answers the
  // rounds get, in order.
  post: vi.fn(),
  rounds: [] as (() => Promise<unknown>)[],
  error: vi.fn(),
}))

vi.mock('@mochi/web', async (importOriginal) => {
  const original = await importOriginal<typeof import('@mochi/web')>()
  return {
    ...original,
    requestHelpers: { ...original.requestHelpers, post: state.post },
    toast: { success: vi.fn(), error: state.error },
    getAppPath: () => '/calendars',
  }
})

function round(fields: Partial<ImportResponse>): ImportResponse {
  return {
    import: 'staged1',
    offset: 0,
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    finished: false,
    ...fields,
  }
}

// What one request sent, read from its form.
function sent(call: number) {
  const [url, data] = state.post.mock.calls[call] as [string, FormData]
  return {
    url,
    calendar: data.get('calendar'),
    offset: data.get('offset'),
    staged: data.get('import'),
    file: data.get('file'),
  }
}

function show(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  // Cached queries as a page holds them.
  queryClient.setQueryData(['instances', 0, 1, ['c1'], 'UTC'], {
    instances: [],
  })
  queryClient.setQueryData(['event', 'e1'], { event: {} })
  queryClient.setQueryData(['bounds', ['c1']], { start: 0, finish: 1 })
  render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <ImportDialog calendar={calendar} onClose={onClose} />
      </I18nProvider>
    </QueryClientProvider>
  )
  const invalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false
  return { invalidated, onClose }
}

const file = new File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], 'work.ics', {
  type: 'text/calendar',
})

// The footer's Close, not the corner button every dialog carries.
function footerClose() {
  return screen
    .getAllByRole('button', { name: 'Close' })
    .find((button) => !button.querySelector('.sr-only'))
}

// The corner button every dialog carries.
function cornerClose() {
  return screen
    .getAllByRole('button', { name: 'Close' })
    .find((button) => button.querySelector('.sr-only'))
}

function start() {
  fireEvent.change(screen.getByLabelText('iCalendar file'), {
    target: { files: [file] },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

describe('ImportDialog', () => {
  beforeEach(() => {
    state.rounds = []
    state.error.mockReset()
    state.post.mockReset().mockImplementation(() => {
      const next = state.rounds.shift()
      return next ? next() : Promise.reject(new Error('no round left'))
    })
  })

  it('sends the file once, then the staged id and offset until finished, and sums the rounds', async () => {
    state.rounds = [
      () =>
        Promise.resolve(
          round({
            offset: 200,
            total: 407,
            imported: 150,
            skipped: 40,
            failed: 10,
          })
        ),
      () => Promise.resolve(round({ offset: 400, total: 407, imported: 200 })),
      () =>
        Promise.resolve(
          round({
            offset: 407,
            total: 407,
            imported: 5,
            skipped: 1,
            failed: 1,
            finished: true,
          })
        ),
    ]
    const { invalidated } = show()
    start()

    expect(await screen.findByText('355 events imported')).toBeInTheDocument()
    expect(
      screen.getByText('41 events already in the calendar')
    ).toBeInTheDocument()
    expect(
      screen.getByText('11 events could not be imported')
    ).toBeInTheDocument()

    expect(state.post).toHaveBeenCalledTimes(3)
    expect(sent(0)).toEqual({
      url: '/calendars/-/calendars/import',
      calendar: 'c1',
      offset: '0',
      staged: null,
      file: expect.any(File),
    })
    expect((sent(0).file as File).name).toBe('work.ics')
    expect(sent(1)).toEqual({
      url: '/calendars/-/calendars/import',
      calendar: 'c1',
      offset: '200',
      staged: 'staged1',
      file: null,
    })
    expect(sent(2)).toMatchObject({
      offset: '400',
      staged: 'staged1',
      file: null,
    })

    // The rounds wrote events, so the views read them again.
    expect(invalidated(['instances', 0, 1, ['c1'], 'UTC'])).toBe(true)
    expect(invalidated(['event', 'e1'])).toBe(true)
    expect(invalidated(['bounds', ['c1']])).toBe(true)
    expect(footerClose()).toBeInTheDocument()
    expect(state.error).not.toHaveBeenCalled()
  })

  it('shows how far the import has got while it runs, and holds the dialog open', async () => {
    let finish: (value: ImportResponse) => void = () => {}
    state.rounds = [
      () => Promise.resolve(round({ offset: 200, total: 407, imported: 200 })),
      () =>
        new Promise<ImportResponse>((resolve) => {
          finish = resolve
        }),
    ]
    const { onClose } = show()
    start()

    expect(await screen.findByText('200 of 407 events')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toHaveAttribute(
      'aria-busy',
      'true'
    )
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(cornerClose() as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()

    finish(round({ offset: 407, total: 407, imported: 207, finished: true }))
    expect(await screen.findByText('407 events imported')).toBeInTheDocument()
    // Nothing skipped or failed, so neither is mentioned.
    expect(screen.queryByText(/already in the calendar/)).toBeNull()
    expect(screen.queryByText(/could not be imported/)).toBeNull()
    fireEvent.click(footerClose() as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('names one event in the singular', async () => {
    state.rounds = [
      () =>
        Promise.resolve(
          round({
            offset: 3,
            total: 3,
            imported: 1,
            skipped: 1,
            failed: 1,
            finished: true,
          })
        ),
    ]
    show()
    start()
    expect(await screen.findByText('1 event imported')).toBeInTheDocument()
    expect(
      screen.getByText('1 event already in the calendar')
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 event could not be imported')
    ).toBeInTheDocument()
  })

  it('says why a round failed and makes no further requests', async () => {
    state.rounds = [
      () => Promise.resolve(round({ offset: 200, total: 407, imported: 200 })),
      () => Promise.reject(new Error('The import was not found')),
      () =>
        Promise.resolve(
          round({ offset: 407, total: 407, imported: 207, finished: true })
        ),
    ]
    const { invalidated } = show()
    start()

    await waitFor(() =>
      expect(state.error).toHaveBeenCalledWith('The import was not found')
    )
    expect(state.post).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/events imported/)).toBeNull()
    // The form is back to try again.
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
    // The first round wrote its events before the second failed.
    expect(invalidated(['instances', 0, 1, ['c1'], 'UTC'])).toBe(true)
  })

  it('sends nothing without a file', () => {
    show()
    const button = screen.getByRole('button', { name: 'Import' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(state.post).not.toHaveBeenCalled()
  })
})
