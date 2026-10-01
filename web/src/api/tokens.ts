// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { requestHelpers } from '@mochi/web'
import endpoints from '@/api/endpoints'
import { body, form, quiet } from '@/api/request'
import type { CreateTokenResponse, GetTokensResponse } from '@/api/types/tokens'

// Each device gets its own named token, so this is create and never ensure:
// a second device with the same name is still a second credential.
export const tokensApi = {
  create: (name: string): Promise<CreateTokenResponse> =>
    requestHelpers.post<CreateTokenResponse>(
      endpoints.tokens.create,
      body({ name }),
      { ...form, ...quiet }
    ),

  list: (): Promise<GetTokensResponse> =>
    requestHelpers.post<GetTokensResponse>(endpoints.tokens.list, '', {
      ...form,
      ...quiet,
    }),

  delete: (hash: string): Promise<{ ok: boolean }> =>
    requestHelpers.post<{ ok: boolean }>(
      endpoints.tokens.delete,
      body({ hash }),
      { ...form, ...quiet }
    ),
}
