import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { describeHomepageImagesFailure, failureMessage } from './homepageImages.errors'

/** The Arabic texts with i18next's {{name}} interpolation, as academy.errors.test.ts reads them. */
const t = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ar)
  const text = typeof value === 'string' ? value : key
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}

const formatBytes = (bytes: number) => `${bytes / 1_048_576} MB`
const describe_ = (error: unknown) => describeHomepageImagesFailure(error, formatBytes, 5_242_880)
const apiError = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.message ?? status), { statusCode: status, ...body })

describe('describeHomepageImagesFailure', () => {
  it('maps every code of the pictures to its message, `image_invalid` by its reason', () => {
    expect(describe_(apiError(404, { code: 'homepage_image_unknown', key: 'x', keys: [] }))).toEqual({ key: 'homepageImages.errors.homepage_image_unknown' })
    expect(describe_(apiError(415, { code: 'image_type_unsupported', contentTypes: [] }))).toEqual({ key: 'homepageImages.errors.image_type_unsupported' })
    for (const reason of ['empty', 'unrecognized', 'type_mismatch', 'corrupt']) {
      expect(describe_(apiError(400, { code: 'image_invalid', reason }))).toEqual({ key: `homepageImages.errors.image_invalid_${reason}` })
    }
    expect(describe_(apiError(400, { code: 'image_invalid', reason: 'something_new' }))).toEqual({ key: 'homepageImages.errors.image_invalid' })
    expect(describe_(apiError(503, { code: 'media_storage_unavailable' }))).toEqual({ key: 'homepageImages.errors.media_storage_unavailable' })
    expect(describe_(apiError(503, { code: 'academy_not_configured' }))).toEqual({ key: 'homepageImages.errors.academy_not_configured' })
    expect(describe_(apiError(403, { code: 'origin_forbidden' }))).toEqual({ key: 'homepageImages.errors.origin_forbidden' })
  })

  it('carries the details the messages name: the size limit, the dimension limits and a missing permission', () => {
    expect(describe_(apiError(413, { code: 'image_too_large', maxBytes: 2_097_152 }))).toEqual({ key: 'homepageImages.errors.image_too_large', params: { max: '2 MB' } })
    expect(describe_(apiError(400, { code: 'image_dimensions_invalid', width: 10, height: 10, minSide: 64, maxSide: 8000, maxPixels: 40_000_000 }))).toEqual({
      key: 'homepageImages.errors.image_dimensions_invalid',
      params: { min: '64', max: '8000', pixels: '40' },
    })
    expect(describe_(apiError(403, { code: 'permission_denied', missing: ['academy.settings.manage'] }))).toEqual({
      key: 'homepageImages.errors.permission_denied',
      params: { list: '(academy.settings.manage)' },
    })
  })

  it('reads a 413 or a 415 without a code (a proxy in front of the API answered) as the size or the type refusal', () => {
    expect(describe_(new ApiError(413, '413 Payload Too Large'))).toEqual({ key: 'homepageImages.errors.image_too_large', params: { max: '5 MB' } })
    expect(describe_(new ApiError(415, '415 Unsupported Media Type'))).toEqual({ key: 'homepageImages.errors.image_type_unsupported' })
  })

  it('falls back to the shared messages: validation, server, generic and network', () => {
    expect(describe_(apiError(400, { message: 'bad' }))).toEqual({ key: 'homepageImages.errors.validation', params: { message: 'bad' } })
    expect(describe_(apiError(500, {}))).toEqual({ key: 'login.errors.server' })
    expect(describe_(apiError(409, {}))).toEqual({ key: 'login.errors.generic' })
    expect(describe_(new TypeError('Failed to fetch'))).toEqual({ key: 'login.errors.network' })
  })

  it('renders in Arabic with its details', () => {
    expect(failureMessage(t, describe_(apiError(503, { code: 'media_storage_unavailable' })))).toBe(ar.homepageImages.errors.media_storage_unavailable)
    expect(failureMessage(t, describe_(apiError(413, { code: 'image_too_large', maxBytes: 5_242_880 })))).toBe('الملف أكبر من الحد الذي يقبله الخادم (5 MB).')
    expect(failureMessage(t, describe_(apiError(403, { code: 'permission_denied' })))).toBe('ليست لديك صلاحية إدارة صور الصفحة الرئيسية')
  })
})
