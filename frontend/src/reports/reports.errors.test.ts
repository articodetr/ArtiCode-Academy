import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { describeReportsFailure, failureMessage } from './reports.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

describe('describeReportsFailure', () => {
  it('names a refused period with the days and the limit the server sent', () => {
    const failure = describeReportsFailure(
      new ApiError(400, 'range', { statusCode: 400, code: 'report_range_invalid', message: 'range', from: '2025-01-01', to: '2026-11-11', maxDays: 366 }),
    )
    expect(failure).toEqual({ key: 'reports.errors.report_range_invalid', field: 'period', params: { from: '2025-01-01', to: '2026-11-11', maxDays: '366' } })
    expect(failureMessage(t, failure)).toBe('رفض الخادم الفترة من 2025-01-01 إلى 2026-11-11: اليوم الأول لا يقع بعد الأخير، والفترة 366 يوماً على الأكثر.')
  })

  it('lists the keys of a permission refusal, and reads it without them too', () => {
    const failure = describeReportsFailure(new ApiError(403, 'denied', { statusCode: 403, code: 'permission_denied', missing: ['reports.academic.view'] }))
    expect(failureMessage(t, failure)).toBe('لا تملك صلاحية هذا التقرير (reports.academic.view)')
    expect(failureMessage(t, describeReportsFailure(new ApiError(403, 'denied', { code: 'permission_denied' })))).toBe('لا تملك صلاحية هذا التقرير')
  })

  it('shows a validation 400 with the server message, and the shared families otherwise', () => {
    expect(failureMessage(t, describeReportsFailure(new ApiError(400, 'property from should not exist', { statusCode: 400, message: ['property from should not exist'] })))).toBe(
      'رفض الخادم المرشّحات: property from should not exist',
    )
    expect(describeReportsFailure(new ApiError(429, 'slow down', { code: 'rate_limited' })).key).toBe('login.errors.rate_limited')
    expect(describeReportsFailure(new ApiError(503, 'down')).key).toBe('login.errors.server')
    expect(describeReportsFailure(new ApiError(404, 'nope')).key).toBe('login.errors.generic')
    expect(failureMessage(t, describeReportsFailure(new TypeError('Failed to fetch')))).toBe(ar.login.errors.network)
  })
})
