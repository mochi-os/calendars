// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { getAppPath } from '@mochi/web'

// Class-level actions are addressed absolutely: on a calendar's own URL
// (/calendars/<fingerprint>) the request layer's baseURL becomes
// /calendars/<fingerprint>/-/, and a relative "-/events" would fall through to
// the SPA catch-all. Under domain routing getAppPath() is empty, so fall back
// to relative.
const app = getAppPath()
const prefix = app ? `${app}/-` : '-'

const endpoints = {
  calendars: {
    list: `${prefix}/calendars`,
    get: `${prefix}/calendars/get`,
    create: `${prefix}/calendars/create`,
    rename: `${prefix}/calendars/rename`,
    colour: `${prefix}/calendars/colour`,
    delete: `${prefix}/calendars/delete`,
    subscribe: `${prefix}/calendars/subscribe`,
    poll: `${prefix}/calendars/poll`,
    accounts: `${prefix}/calendars/accounts`,
    account: `${prefix}/calendars/account`,
    grant: `${prefix}/calendars/grant`,
    remote: `${prefix}/calendars/remote`,
    link: `${prefix}/calendars/link`,
  },
  events: {
    list: `${prefix}/events`,
    bounds: `${prefix}/events/bounds`,
    get: `${prefix}/events/get`,
    create: `${prefix}/events/create`,
    update: `${prefix}/events/update`,
    split: `${prefix}/events/split`,
    delete: `${prefix}/events/delete`,
  },
  link: {
    get: `${prefix}/link`,
    revoke: `${prefix}/link/revoke`,
  },
  preferences: {
    get: `${prefix}/preferences/get`,
    set: `${prefix}/preferences/set`,
  },
  tokens: {
    create: `${prefix}/token/create`,
    list: `${prefix}/token/list`,
    delete: `${prefix}/token/delete`,
  },
} as const

export default endpoints
