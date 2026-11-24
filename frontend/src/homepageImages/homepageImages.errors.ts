// Maps a failed homepage images request (GET, PUT and DELETE /api/academy/homepage-images)
// to a translation key under homepageImages.errors.* — the codes of the academy module
// for the pictures, plus the shared auth/permission/origin codes. `image_invalid` is told
// apart by its `reason` (empty | unrecognized | type_mismatch | corrupt). A 413 or a 415
// that carries no code (a proxy in front of the API answered it) reads as
// `image_too_large` / `image_type_unsupported`.
import { ApiError } from '../api/client'
import type { UsersFailure } from '../users/users.errors'
import { PICTURE_MAX_PIXELS, PICTURE_MAX_SIDE, PICTURE_MIN_SIDE } from './homepageImages.rules'

export { failureMessage } from '../users/users.errors'

/** Same shape as a users failure, so `failureMessage()` renders both. */
export type HomepageImagesFailure = UsersFailure

const KNOWN_CODES = new Set([
  'homepage_image_unknown',
  'image_type_unsupported',
  'image_too_large',
  'image_invalid',
  'image_dimensions_invalid',
  'media_storage_unavailable',
  'academy_not_configured',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

const INVALID_REASONS = new Set(['empty', 'unrecognized', 'type_mismatch', 'corrupt'])

function stringList(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length > 0 ? items.join(', ') : undefined
}

const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** `formatBytes` writes a byte count the way the screen shows sizes («5 ميغابايت»). */
export function describeHomepageImagesFailure(error: unknown, formatBytes: (bytes: number) => string, maxBytes: number): HomepageImagesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  const code = error.code && KNOWN_CODES.has(error.code) ? error.code : error.status === 413 ? 'image_too_large' : error.status === 415 ? 'image_type_unsupported' : null

  if (code === 'image_invalid') {
    return { key: typeof body.reason === 'string' && INVALID_REASONS.has(body.reason) ? `homepageImages.errors.image_invalid_${body.reason}` : 'homepageImages.errors.image_invalid' }
  }
  if (code === 'image_too_large') return { key: 'homepageImages.errors.image_too_large', params: { max: formatBytes(numberOr(body.maxBytes, maxBytes)) } }
  if (code === 'image_dimensions_invalid') {
    return {
      key: 'homepageImages.errors.image_dimensions_invalid',
      params: {
        min: String(numberOr(body.minSide, PICTURE_MIN_SIDE)),
        max: String(numberOr(body.maxSide, PICTURE_MAX_SIDE)),
        pixels: String(numberOr(body.maxPixels, PICTURE_MAX_PIXELS) / 1_000_000),
      },
    }
  }
  if (code) {
    const failure: HomepageImagesFailure = { key: `homepageImages.errors.${code}` }
    const list = stringList(body.missing)
    if (list) failure.params = { list: `(${list})` }
    return failure
  }
  if (error.status === 400) {
    // Validation failures carry no code; the server lists the rejected constraints.
    return { key: 'homepageImages.errors.validation', params: { message: error.message } }
  }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
