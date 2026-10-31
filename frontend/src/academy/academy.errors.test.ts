import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { ar } from '../i18n/ar'
import { describeAcademyFailure, failureMessage } from './academy.errors'

const t = (key: string, options?: Record<string, unknown>) => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ar)
  const text = typeof value === 'string' ? value : key
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}

describe('describeAcademyFailure', () => {
  it('maps the backend codes to settings.errors.* (the 503 by its code, not as a server error)', () => {
    const notConfigured = describeAcademyFailure(new ApiError(503, 'seed', { code: 'academy_not_configured' }))
    expect(notConfigured).toEqual({ key: 'settings.errors.academy_not_configured' })
    expect(failureMessage(t, notConfigured)).toBe(ar.settings.errors.academy_not_configured)

    expect(describeAcademyFailure(new ApiError(400, 'empty', { code: 'nothing_to_update' }))).toEqual({ key: 'settings.errors.nothing_to_update' })
    expect(describeAcademyFailure(new ApiError(403, 'denied', { code: 'permission_denied', missing: ['academy.settings.manage'] }))).toEqual({
      key: 'settings.errors.permission_denied',
      params: { list: '(academy.settings.manage)' },
    })
  })

  it('reports validation failures with the server message, and the generic families otherwise', () => {
    const validation = describeAcademyFailure(new ApiError(400, 'timezone must be a canonical IANA time zone name', { message: ['…'] }))
    expect(validation).toEqual({ key: 'settings.errors.validation', params: { message: 'timezone must be a canonical IANA time zone name' } })
    expect(failureMessage(t, validation)).toBe('رفض الخادم البيانات: timezone must be a canonical IANA time zone name')

    expect(describeAcademyFailure(new ApiError(500, 'boom'))).toEqual({ key: 'login.errors.server' })
    expect(describeAcademyFailure(new ApiError(404, 'gone'))).toEqual({ key: 'login.errors.generic' })
    expect(describeAcademyFailure(new TypeError('fetch failed'))).toEqual({ key: 'login.errors.network' })
  })
})
