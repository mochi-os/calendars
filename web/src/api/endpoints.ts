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
// Every action below is a literal; nothing in this table is built from data.
const action = (name: string) => (app ? `${app}/-/${name}` : `-/${name}`) // path-ok: the app's own path and a literal action

const endpoints = {
  calendars: {
    list: action('calendars'),
    get: action('calendars/get'),
    create: action('calendars/create'),
    rename: action('calendars/rename'),
    colour: action('calendars/colour'),
    delete: action('calendars/delete'),
    subscribe: action('calendars/subscribe'),
    poll: action('calendars/poll'),
    refresh: action('calendars/refresh'),
    accounts: action('calendars/accounts'),
    account: action('calendars/account'),
    grant: action('calendars/grant'),
    remote: action('calendars/remote'),
    link: action('calendars/link'),
    import: action('calendars/import'),
    export: action('calendars/export'),
    publish: action('calendars/publish'),
    publishSet: action('calendars/publish/set'),
    publishForget: action('calendars/publish/forget'),
  },
  events: {
    list: action('events'),
    bounds: action('events/bounds'),
    get: action('events/get'),
    create: action('events/create'),
    update: action('events/update'),
    split: action('events/split'),
    delete: action('events/delete'),
  },
  link: {
    get: action('link'),
    revoke: action('link/revoke'),
  },
  preferences: {
    get: action('preferences/get'),
    set: action('preferences/set'),
  },
  tokens: {
    create: action('token/create'),
    list: action('token/list'),
    delete: action('token/delete'),
  },
} as const

export default endpoints
