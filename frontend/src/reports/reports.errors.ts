// Maps a failed report request to a translation key (MOD-13-T06 — J-F53).
// Codes: the one MOD-13 dictionary, backend/src/reports/reports.errors.ts
// (`report_range_invalid { from, to, maxDays }`), plus the guards' and the
// overview controller's `permission_denied { missing }`; a validation failure
// is the ValidationPipe's plain 400 without a code. Unit-tested in
// reports.errors.test.ts.
import { ApiError } from '../api/client'
import { REPORT_MAX_PERIOD_DAYS } from '../api/reports'
import type { Translate } from '../users/users.format'

export interface ReportsFailure {
  /** Translation key, e.g. `reports.errors.report_range_invalid`. */
  key: string
  params?: Record<string, string>
  /** The filter the message belongs to, when the code names one. */
  field?: 'period'
}

function bodyOf(error: ApiError): Record<string, unknown> {
  return (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function describeReportsFailure(error: unknown): ReportsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = bodyOf(error)
  if (error.code === 'report_range_invalid') {
    return {
      key: 'reports.errors.report_range_invalid',
      field: 'period',
      params: {
        from: typeof body.from === 'string' ? body.from : '',
        to: typeof body.to === 'string' ? body.to : '',
        maxDays: String(typeof body.maxDays === 'number' ? body.maxDays : REPORT_MAX_PERIOD_DAYS),
      },
    }
  }
  if (error.code === 'permission_denied') {
    const missing = strings(body.missing)
    return { key: 'reports.errors.permission_denied', params: missing.length > 0 ? { list: `(${missing.join(', ')})` } : undefined }
  }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited' }
  // Validation failures carry no code; the server lists the refused constraints.
  if (error.status === 400) return { key: 'reports.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}

/** Translates a failure; a key with an optional `{{list}}`/`{{message}}` renders cleanly without one. */
export function failureMessage(t: Translate, failure: ReportsFailure): string {
  return t(failure.key, { list: '', message: '', ...failure.params }).trim()
}
