// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useState } from 'react'
import { Input } from '@mochi/web'

/**
 * A whole number typed freely: the field holds what is typed, so it can be
 * emptied to type a new number, and only a number in range reaches the form.
 * Leaving the field shows the number the form holds again.
 */
export function CountInput({
  id,
  value,
  maximum,
  onChange,
}: {
  id: string
  value: number
  maximum: number
  onChange: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <Input
      id={id}
      type='number'
      min={1}
      max={maximum}
      value={text ?? String(value)}
      onChange={(input) => {
        const typed = input.target.value
        setText(typed)
        const number = Number(typed)
        if (typed.trim() !== '' && Number.isInteger(number) && number >= 1) {
          onChange(Math.min(maximum, number))
        }
      }}
      onBlur={() => setText(null)}
    />
  )
}
