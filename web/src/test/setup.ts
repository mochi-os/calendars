// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { i18n } from '@lingui/core'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// An empty catalogue on an active locale, so the Lingui macro resolves to its
// embedded English source in every test, rendered or not.
i18n.loadAndActivate({ locale: 'en', messages: {} })

afterEach(() => {
  cleanup()
})

// jsdom implements none of these; Radix's popper-backed primitives reach for
// the first two on mount and the list view watches its foot with the third.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

global.ResizeObserver = class ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

global.IntersectionObserver = class IntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  root = null
  rootMargin = ''
  thresholds: number[] = []
} as unknown as typeof globalThis.IntersectionObserver

Element.prototype.scrollIntoView = vi.fn()
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.releasePointerCapture = vi.fn()
Element.prototype.hasPointerCapture = vi.fn(() => false)
