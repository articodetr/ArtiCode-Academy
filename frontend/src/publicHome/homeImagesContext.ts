// The page's API-205 reading, shared with the four pictures of /home (HomeImage) without threading a prop through
// every band. PublicHomePage provides it; without a provider (null) every place shows its built-in default.
import { createContext, useContext } from 'react'
import { homeImageSrc } from './homeImages.view'
import type { HomeImagesReading } from './homeImages.view'
import type { HomeImageKey } from './homeImageSlots'

export const HomeImagesContext = createContext<HomeImagesReading | null>(null)

/** The source of one place right now — see homeImageSrc(): null while API-205 is still loading. */
export function useHomeImageSrc(key: HomeImageKey): string | null {
  return homeImageSrc(key, useContext(HomeImagesContext))
}
