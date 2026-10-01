// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountInput } from './count-input'

function Harness({ start }: { start: number }) {
  const [value, setValue] = useState(start)
  return (
    <>
      <CountInput id='count' value={value} maximum={999} onChange={setValue} />
      <output>{value}</output>
    </>
  )
}

describe('CountInput', () => {
  it('can be emptied to type a new number', () => {
    render(<Harness start={1} />)
    const field = screen.getByRole('spinbutton')
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '' } })
    expect(field).toHaveValue(null)
    fireEvent.change(field, { target: { value: '3' } })
    expect(screen.getByRole('status')).toHaveTextContent('3')
  })

  it('shows the number held once the field is left empty', () => {
    render(<Harness start={4} />)
    const field = screen.getByRole('spinbutton')
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(field).toHaveValue(4)
    expect(screen.getByRole('status')).toHaveTextContent('4')
  })

  it('keeps a number past the maximum to the maximum', () => {
    render(<Harness start={1} />)
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '5000' },
    })
    expect(screen.getByRole('status')).toHaveTextContent('999')
  })
})
