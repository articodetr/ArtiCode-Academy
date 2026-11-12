// Maps a failed MOD-12 request — «my notifications», the e-mail preferences and
// the announcements (API-167..API-175) — to a translation key, and where the
// code names one input, the composer field that carries the message. One
// dictionary for the module, as backend/src/notifications/notifications.errors.ts
// is one (keep in sync): notification_not_found, nothing_to_update,
// audience_invalid { problems }, audience_empty, audience_too_large
// { recipients, max }, class_not_found, announcement_not_found — plus the
// guards (permission_denied { missing }, origin_forbidden, rate_limited) and a
// validation refusal without a code. Unit-tested in notifications.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

/** A users failure plus, for `audience_invalid`, the problems the server named. */
export interface NotificationsFailure extends UsersFailure {
  problems?: string[]
}

const MODULE_CODES = new Set([
  'notification_not_found',
  'nothing_to_update',
  'audience_invalid',
  'audience_empty',
  'audience_too_large',
  'class_not_found',
  'announcement_not_found',
  'permission_denied',
])

/**
 * What `audience_invalid { problems }` names (AUDIENCE_PROBLEMS of backend/src/notifications/announcements.audience.ts —
 * keep in sync); an unknown problem is shown as the server spelled it.
 */
export const AUDIENCE_PROBLEMS = [
  'kind_unknown',
  'class_id_required',
  'recipient_group_required',
  'role_keys_not_allowed',
  'class_fields_not_allowed',
  'role_keys_required',
  'role_keys_unknown',
  'role_keys_duplicate',
] as const

/** Composer fields (AnnouncementFormValues) a code points at. */
const FIELD_OF_CODE: Readonly<Record<string, string[]>> = {
  class_not_found: ['classId'],
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** The failure's text; `audience_invalid` lists its problems in words. */
export function failureMessage(t: (key: string, options?: Record<string, unknown>) => string, failure: NotificationsFailure): string {
  if (!failure.problems?.length) return usersFailureMessage(t, failure)
  const known: readonly string[] = AUDIENCE_PROBLEMS
  const words = failure.problems.map((problem) => (known.includes(problem) ? t(`notifications.errors.problems.${problem}`) : problem))
  return usersFailureMessage(t, { ...failure, params: { ...failure.params, list: words.join(t('notifications.errors.listSeparator')) } })
}

export function describeNotificationsFailure(error: unknown): NotificationsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && MODULE_CODES.has(error.code)) {
    const failure: NotificationsFailure = { key: `notifications.errors.${error.code}` }
    const field = FIELD_OF_CODE[error.code]
    if (field) failure.field = field
    if (error.code === 'audience_invalid') failure.problems = strings(body.problems)
    if (error.code === 'audience_too_large' && typeof body.recipients === 'number' && typeof body.max === 'number') {
      failure.params = { recipients: String(body.recipients), max: String(body.max) }
    }
    const missing = strings(body.missing)
    if (error.code === 'permission_denied') failure.params = { list: missing.length > 0 ? `(${missing.join(', ')})` : '' }
    return failure
  }
  if (error.code === 'origin_forbidden') return { key: 'users.errors.origin_forbidden' }
  if (error.code === 'rate_limited') return { key: 'login.errors.rate_limited' }
  if (error.status === 400) return { key: 'notifications.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
