// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { useLingui } from '@lingui/react/macro'
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useLinks,
} from '@mochi/web'
import { MapPin, Plane } from 'lucide-react'
import { locationTarget } from '@/lib/location'

/**
 * The button beside an event's location field that opens the place on a map,
 * or the flight on the user's tracker; nothing while the field is empty.
 */
export function LocationButton({ location }: { location: string }) {
  const { t } = useLingui()
  const links = useLinks()
  if (!location.trim()) return null
  const { href, flight } = locationTarget(location, links)
  const label = flight ? t`Track flight` : t`Show on map`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant='ghost' size='icon' className='shrink-0' asChild>
          {/* In a new tab: the shell's sandbox allows popups, so a plain
            anchor is enough. */}
          <a
            href={href}
            target='_blank'
            rel='noopener noreferrer'
            aria-label={label}
          >
            {flight ? (
              <Plane className='size-4' />
            ) : (
              <MapPin className='size-4' />
            )}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
