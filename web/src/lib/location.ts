// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { flightNumber, type useLinks } from '@mochi/web'

/**
 * Where an event's location opens: a flight number on the user's flight
 * tracker, anything else as a map search on the user's map service.
 */
export function locationTarget(
  location: string,
  links: ReturnType<typeof useLinks>
): { href: string; flight: boolean } {
  const flight = flightNumber(location)
  return flight
    ? { href: links.flight(flight), flight: true }
    : { href: links.map(location), flight: false }
}
