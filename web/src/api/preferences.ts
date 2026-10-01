// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import { quiet } from '@/api/request'
import type { Preferences, PreferencesResponse } from '@/api/types/preferences'

export const preferencesApi = {
  get: (): Promise<PreferencesResponse> =>
    requestHelpers.get<PreferencesResponse>(endpoints.preferences.get, quiet),

  set: (values: Partial<Preferences>): Promise<PreferencesResponse> =>
    requestHelpers.post<PreferencesResponse>(
      endpoints.preferences.set,
      values,
      quiet
    ),
}
