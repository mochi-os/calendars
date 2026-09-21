// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

// A device's credential as token/list returns it: the plaintext exists only
// in the create response. created and used are unix seconds; used 0 is never.
interface Token {
  hash: string
  name: string
  scopes: string[]
  action: string
  entity: string
  created: number
  used: number
  expires: number
}

export interface CreateTokenResponse {
  token: string
}

export interface GetTokensResponse {
  tokens: Token[]
}
