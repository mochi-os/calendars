// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublishSwitches, PublishingSection } from './publishing'

const state = vi.hoisted(() => ({
  publish: vi.fn(),
  setPublish: vi.fn(),
  forgetCopies: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/api/calendars', () => ({
  calendarsApi: {
    publish: state.publish,
    setPublish: state.setPublish,
    forgetCopies: state.forgetCopies,
  },
}))

vi.mock('@mochi/web', async (original) => ({
  ...(await original<typeof import('@mochi/web')>()),
  toast: { success: state.success, error: state.error },
}))

const accounts = [
  {
    id: 'm1',
    type: 'mastodon',
    identifier: '@alice@mastodon.social',
    name: 'Alice',
    hosted: false,
  },
  {
    id: 'f1',
    type: 'fediverse',
    identifier: '@alice@example.org',
    name: 'Alice',
    hosted: true,
  },
]

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider i18n={i18n}>{children}</I18nProvider>
    </QueryClientProvider>
  )
}

describe('Publishing section', () => {
  beforeEach(() => {
    i18n.load('en', {})
    i18n.activate('en')
    state.publish.mockReset().mockResolvedValue({
      accounts,
      publish: ['m1'],
      copies: { m1: 2 },
    })
    state.setPublish.mockReset()
    state.forgetCopies.mockReset()
    state.success.mockReset()
    state.error.mockReset()
  })

  it('lists the accounts with a switch each, on for those the calendar publishes to', async () => {
    wrap(<PublishingSection calendar='c1' />)
    expect(await screen.findByText('@alice@mastodon.social')).toBeTruthy()
    expect(screen.getByText('Mastodon · 2 copies')).toBeTruthy()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')
  })

  it('shows nothing where the user has no account to publish to', async () => {
    state.publish.mockResolvedValue({ accounts: [], publish: [], copies: {} })
    wrap(<PublishingSection calendar='c1' />)
    await waitFor(() => expect(state.publish).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Publish to')).toBeNull()
  })

  it('adds an account to the list', async () => {
    state.setPublish.mockResolvedValue({ publish: ['m1', 'f1'], kept: {} })
    wrap(<PublishingSection calendar='c1' />)
    await screen.findByText('@alice@example.org')
    fireEvent.click(
      screen.getByRole('switch', { name: 'Publish to @alice@example.org' })
    )
    await waitFor(() =>
      expect(state.setPublish).toHaveBeenCalledWith('c1', ['m1', 'f1'])
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('offers to delete the copies left on an account taken off the list, and keeps them by default', async () => {
    state.setPublish.mockResolvedValue({ publish: [], kept: { m1: 2 } })
    state.forgetCopies.mockResolvedValue({ deleted: 2 })
    wrap(<PublishingSection calendar='c1' />)
    await screen.findByText('@alice@mastodon.social')
    fireEvent.click(
      screen.getByRole('switch', { name: 'Publish to @alice@mastodon.social' })
    )
    expect(
      await screen.findByText('Delete the copies on @alice@mastodon.social?')
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Copies published there: 2. They stay unless you delete them.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete copies' }))
    await waitFor(() =>
      expect(state.forgetCopies).toHaveBeenCalledWith('c1', 'm1')
    )
    expect(state.success).toHaveBeenCalledWith('Deleted 2 copies')
  })

  it('says so when the list cannot be saved', async () => {
    state.setPublish.mockRejectedValue(new Error('refused'))
    wrap(<PublishingSection calendar='c1' />)
    await screen.findByText('@alice@example.org')
    fireEvent.click(
      screen.getByRole('switch', { name: 'Publish to @alice@example.org' })
    )
    await waitFor(() => expect(state.error).toHaveBeenCalled())
  })
})

describe('Publish switches', () => {
  beforeEach(() => {
    i18n.load('en', {})
    i18n.activate('en')
    state.publish.mockReset().mockResolvedValue({
      accounts,
      publish: ['f1'],
      copies: {},
    })
  })

  it("start from the calendar's list and report a change", async () => {
    const changed = vi.fn()
    wrap(<PublishSwitches calendar='c1' chosen={null} onChange={changed} />)
    const hosted = await screen.findByRole('switch', {
      name: '@alice@example.org',
    })
    expect(hosted).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(
      screen.getByRole('switch', { name: '@alice@mastodon.social' })
    )
    expect(changed).toHaveBeenCalledWith(['f1', 'm1'])
  })

  it('show what was chosen for the event over the list', async () => {
    wrap(<PublishSwitches calendar='c1' chosen={[]} onChange={vi.fn()} />)
    const hosted = await screen.findByRole('switch', {
      name: '@alice@example.org',
    })
    expect(hosted).toHaveAttribute('aria-checked', 'false')
  })
})
