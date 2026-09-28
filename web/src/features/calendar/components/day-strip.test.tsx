// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DayStrip, HOUR } from './day-strip'

beforeAll(() => {
  // jsdom has no pointer capture; the strip only asks for it.
  HTMLElement.prototype.setPointerCapture ??= () => {}
})

afterEach(() => cleanup())

const nine = 9 * 60

function show(start = nine, finish = nine + 60) {
  const onMove = vi.fn()
  const onResize = vi.fn()
  render(
    <DayStrip
      start={start}
      finish={finish}
      colour='#60a5fa'
      others={[
        {
          start: 12 * 60,
          finish: 13 * 60,
          summary: 'Lunch',
          colour: '#f87171',
        },
      ]}
      hours={{ start: 8, finish: 17 }}
      onMove={onMove}
      onResize={onResize}
    />
  )
  return { onMove, onResize }
}

// The lane starts at the page's left edge in jsdom, so a pixel is a minute
// at HOUR pixels to the hour.
const px = (minutes: number) => (minutes / 60) * HOUR

describe('DayStrip', () => {
  it("draws the event and the day's other events where their times fall", () => {
    show()
    const event = screen.getByTestId('day-strip-event')
    expect(event.style.left).toBe(`${px(nine)}px`)
    expect(event.style.width).toBe(`${px(60)}px`)
    const lunch = screen.getByTitle('Lunch')
    expect(lunch.style.left).toBe(`${px(12 * 60)}px`)
  })

  it('moves the event along as it is dragged, on five-minute steps', () => {
    const { onMove } = show()
    const event = screen.getByTestId('day-strip-event')
    fireEvent.pointerDown(event, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(event, { clientX: 500 + px(32), pointerId: 1 })
    expect(onMove).toHaveBeenLastCalledWith(nine + 30)
    fireEvent.pointerUp(event, { pointerId: 1 })
    fireEvent.pointerMove(event, { clientX: 500 + px(120), pointerId: 1 })
    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('stretches the end as its edge is dragged, without moving the start', () => {
    const { onMove, onResize } = show()
    const end = screen.getByTestId('day-strip-end')
    fireEvent.pointerDown(end, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(end, { clientX: 500 + px(45), pointerId: 1 })
    expect(onResize).toHaveBeenLastCalledWith(nine + 105)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('moves the event to a click on the rest of the day', () => {
    const { onMove } = show()
    fireEvent.pointerDown(screen.getByTestId('day-strip-lane'), {
      clientX: px(14 * 60 + 2),
      pointerId: 1,
    })
    expect(onMove).toHaveBeenLastCalledWith(14 * 60)
  })

  it('reads left to right and stays out of the accessibility tree', () => {
    show()
    const strip = screen.getByTestId('day-strip')
    expect(strip.getAttribute('dir')).toBe('ltr')
    expect(strip.getAttribute('aria-hidden')).toBe('true')
  })
})
