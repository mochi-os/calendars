// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useEffect } from 'react'

type ShortcutView = 'day' | 'week' | 'month' | 'list'

interface Actions {
  blocked: boolean
  today: () => void
  page: (direction: number) => void
  create: () => void
  view: (view: ShortcutView) => void
  search: () => void
}

// Where a key is text being typed; no shortcut is taken from inside one.
const TYPING =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'

// Widgets that move their own focus with the arrow keys, such as a radio
// group or an open menu; an arrow inside one is theirs, not a page turn.
const ARROWED =
  '[role="radiogroup"], [role="tablist"], [role="menu"], [role="menubar"], [role="listbox"], [role="grid"], [role="slider"], [role="tree"]'

const VIEWS: Record<string, ShortcutView> = {
  d: 'day',
  w: 'week',
  m: 'month',
  l: 'list',
}

/**
 * The calendar page's keys: T today, the arrows to page, N a new event, D, W,
 * M and L the views, and / the search. None fires while a dialog is open or
 * while typing. A focused button still takes them, so a click on Today or an
 * event does not switch them off.
 */
export function useCalendarShortcuts(actions: Actions) {
  const { blocked, today, page, create, view, search } = actions
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (blocked || event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      // Shift is refused for letters only: "/" needs it on some layouts.
      if (event.shiftKey && event.key !== '/') return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]'))
        return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(TYPING)) return

      const key = event.key.toLowerCase()
      if (key === 'arrowleft' || key === 'arrowright') {
        if (target?.closest(ARROWED)) return
        event.preventDefault()
        // The page runs the other way in a right-to-left language, as the
        // toolbar's chevrons do.
        const rtl = document.documentElement.dir === 'rtl'
        page((key === 'arrowleft') !== rtl ? -1 : 1)
        return
      }
      if (event.repeat) return
      if (key === 't' || key === 'n' || key === '/' || VIEWS[key]) {
        event.preventDefault()
        if (key === 't') today()
        else if (key === 'n') create()
        else if (key === '/') search()
        else view(VIEWS[key])
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [blocked, today, page, create, view, search])
}
