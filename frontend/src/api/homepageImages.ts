// Homepage images (Settings → «صور الصفحة الرئيسية»): the four pictures of the
// public home page /home that the administration may replace. Three routes, all
// behind `academy.settings.manage`:
// - GET    /api/academy/homepage-images        → the four places, the default or the academy's own picture;
// - PUT    /api/academy/homepage-images/:key   → the body IS the picture (PNG, JPEG or WebP bytes — not JSON,
//                                                not multipart) with its own Content-Type;
// - DELETE /api/academy/homepage-images/:key   → back to the built-in default of that place.
// Every write answers the whole list again (`HomepageImagesDto`), which the screen shows as it is.
// Types mirror the server's DTOs field by field; every call goes through apiRequest
// (Bearer header, refresh-and-retry on 401 — the retry sends the same picture again).
import type { HomeImageKey } from '../publicHome/homeImageSlots'
import { apiRequest } from './client'

/** The largest picture the server accepts: 5 MiB. */
export const HOMEPAGE_IMAGE_MAX_BYTES = 5_242_880

/** The types the server accepts, decided from the bytes (never from the name or the Content-Type alone). */
export const HOMEPAGE_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type HomepageImageContentType = (typeof HOMEPAGE_IMAGE_CONTENT_TYPES)[number]

/** `HomepageImageDto`: one place of /home. A default has `custom: false` and every other field null. */
export interface HomepageImage {
  key: HomeImageKey
  custom: boolean
  /** The public, root-relative address of the academy's picture (`/api/academy/media/<file>`), or null for the default. */
  url: string | null
  contentType: HomepageImageContentType | null
  width: number | null
  height: number | null
  bytes: number | null
  /** When the picture was set (ISO 8601), or null for the default. */
  updatedAt: string | null
}

/** `HomepageImagesDto`: always the four places, in the order heroStudent, aboutLearners, promoTraining, whyClassroom. */
export interface HomepageImages {
  items: HomepageImage[]
  maxBytes: number
  contentTypes: string[]
}

export const HOMEPAGE_IMAGES_PATH = '/api/academy/homepage-images'

const homepageImagePath = (key: HomeImageKey) => `${HOMEPAGE_IMAGES_PATH}/${encodeURIComponent(key)}`

export function getHomepageImages(signal?: AbortSignal): Promise<HomepageImages> {
  return apiRequest<HomepageImages>(HOMEPAGE_IMAGES_PATH, { signal })
}

/**
 * Publishes `picture` in the place `key`: ONE PUT whose body is the picture itself with
 * `contentType` (the type read from its bytes). The picture visitors see changes only
 * when this resolves — a refusal leaves the published one as it was.
 */
export function uploadHomepageImage(key: HomeImageKey, picture: Blob, contentType: HomepageImageContentType, signal?: AbortSignal): Promise<HomepageImages> {
  return apiRequest<HomepageImages>(homepageImagePath(key), { method: 'PUT', rawBody: picture, contentType, signal })
}

/** Restores the built-in default of `key` only (a place already on its default answers the list unchanged). */
export function resetHomepageImage(key: HomeImageKey): Promise<HomepageImages> {
  return apiRequest<HomepageImages>(homepageImagePath(key), { method: 'DELETE' })
}
