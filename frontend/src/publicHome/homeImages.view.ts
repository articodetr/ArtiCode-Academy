// Where each of the four pictures of /home comes from (Settings → Homepage Images): the academy's own picture
// when API-205 names one, the built-in default of the place otherwise (HOME_IMAGES — never deleted), and nothing
// at all while API-205 has not answered yet, so a visitor never sees the default flash before the academy's own
// picture. A failed or older API-205 (no `homepageImages`) leaves every default. Pure rules, no React.
import type { PublicAcademy } from '../api/academy'
import { apiUrl } from '../api/client'
import { HOME_IMAGE_SLOTS } from './homeImageSlots'
import type { HomeImageKey } from './homeImageSlots'

/** The path the API serves the academy's pictures under (`GET /api/academy/media/:file`). */
export const HOME_MEDIA_PATH_PREFIX = '/api/academy/media/'

/**
 * Only a root-relative address of the academy's own media route is used: one file name after the prefix (letters,
 * digits, `.`, `_`, `-`; never a `/`, `\`, `?`, `#`, `%` or a space), so another host, `//host`, `javascript:`,
 * `data:`, a relative path or a way out of the route (`/api/academy/media/../…`) is never put in an <img>.
 */
const HOME_MEDIA_URL = /^\/api\/academy\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * A transparent 1×1 GIF: the source of a place while API-205 is still loading. An <img> keeps its frame only while
 * it has a source (one with `alt=""` and none at all may collapse to nothing); the frames' CSS fixes their shape
 * (`aspect-ratio`), so this pixel takes exactly the size of the picture that follows it, and shows nothing.
 * `data:` images are allowed by the CSP (`img-src 'self' data: …`).
 */
export const HOME_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** What /home knows of the academy (the `usePublicAcademy()` reading of the page). */
export interface HomeImagesReading {
  academy: Pick<PublicAcademy, 'homepageImages'> | null
  /** True until API-205 has answered or failed. */
  loading: boolean
}

/**
 * The source of the academy's own picture of a place, or null. The address is checked as the server sent it
 * (root-relative, HOME_MEDIA_URL) and only then put on the API's origin by apiUrl() — `VITE_API_BASE_URL` when the
 * API lives on another host than the web app, nothing otherwise — so the picture is asked of the API, never of the
 * web host (which would answer 404 and leave the default without a word).
 */
export function academyHomeImageUrl(value: unknown): string | null {
  return typeof value === 'string' && HOME_MEDIA_URL.test(value) ? apiUrl(value) : null
}

/** The built-in picture of a place. */
export function defaultHomeImageSrc(key: HomeImageKey): string {
  return HOME_IMAGE_SLOTS[key].defaultSrc
}

/**
 * The picture of one place: null while API-205 is still loading (show nothing, keep the frame), the academy's own
 * when it names a safe one, the default otherwise — also without a reading at all (a band shown outside /home).
 */
export function homeImageSrc(key: HomeImageKey, reading: HomeImagesReading | null | undefined): string | null {
  if (!reading) return defaultHomeImageSrc(key)
  if (reading.loading) return null
  return academyHomeImageUrl(reading.academy?.homepageImages?.[key]) ?? defaultHomeImageSrc(key)
}
