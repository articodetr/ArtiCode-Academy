// What a failed report read says (MOD-13 dictionary: backend/src/reports/reports.errors.ts — one code).
import { ApiError } from '../api/client'

/** An i18n key under `reports.errors`. */
export function reportFailureKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'reports.errors.network'
  if (error.code === 'report_range_invalid') return 'reports.errors.rangeInvalid'
  if (error.status === 403) return 'reports.errors.forbidden'
  if (error.status === 400) return 'reports.errors.invalid'
  return 'reports.errors.server'
}
