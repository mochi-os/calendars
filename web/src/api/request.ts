// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

// The dialogs render their own failures, so the global toast would be a second
// copy of the same message.
export const quiet = { mochi: { showGlobalErrorToast: false } } as const

export const form = {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
} as const

export const body = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString()
