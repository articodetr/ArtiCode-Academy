// Maps a failed MOD-12 request to a translation key with its parameters. Codes:
// backend/src/notifications/notifications.errors.ts (the whole dictionary) plus
// the auth/permission guards. `audience_invalid` names its problems
// (announcements.audience.ts AUDIENCE_PROBLEMS); `audience_too_large` its
// recipient count and the maximum.
import { ApiError } from '../api/client'

export interface NotificationsFailure {
  key: string
  params?: Record<string, string>
  /** The announcement form field the message belongs to. */
  field?: 'classId' | 'roleKeys' | 'groups'
}

const KNOWN_CODES = new Set([
  'notification_not_found',
  'nothing_to_update',
  'audience_invalid',
  'audience_empty',
  'audience_too_large',
  'class_not_found',
  'announcement_not_found',
  'permission_denied',
  'origin_forbidden',
  'rate_limited',
])

/** The problems of `audience_invalid` a person can act on, each with its own wording. */
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

const FIELD_OF_PROBLEM: Readonly<Record<string, NotificationsFailure['field']>> = {
  class_id_required: 'classId',
  recipient_group_required: 'groups',
  role_keys_required: 'roleKeys',
  role_keys_unknown: 'roleKeys',
  role_keys_duplicate: 'roleKeys',
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export function failureMessage(t: Translate, failure: NotificationsFailure): string {
  return t(failure.key, { list: '', message: '', ...failure.params }).trim()
}

export function describeNotificationsFailure(error: unknown, t?: Translate): NotificationsFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network' }
  const body = (typeof error.body === 'object' && error.body !== null ? error.body : {}) as Record<string, unknown>
  if (error.code && KNOWN_CODES.has(error.code)) {
    const failure: NotificationsFailure = { key: `notifications.errors.${error.code}` }
    if (error.code === 'audience_invalid') {
      const problems = Array.isArray(body.problems) ? body.problems.filter((p): p is string => typeof p === 'string') : []
      const words = problems.map((problem) =>
        t && (AUDIENCE_PROBLEMS as readonly string[]).includes(problem) ? t(`notifications.errors.audienceProblems.${problem}`) : problem,
      )
      if (words.length > 0) failure.params = { list: words.join(' · ') }
      const field = problems.map((problem) => FIELD_OF_PROBLEM[problem]).find(Boolean)
      if (field) failure.field = field
    }
    if (error.code === 'audience_too_large') {
      failure.params = {
        recipients: typeof body.recipients === 'number' ? String(body.recipients) : '?',
        max: typeof body.max === 'number' ? String(body.max) : '5000',
      }
    }
    if (error.code === 'class_not_found') failure.field = 'classId'
    if (error.code === 'permission_denied' && Array.isArray(body.missing)) {
      failure.params = { list: `(${body.missing.filter((key): key is string => typeof key === 'string').join(', ')})` }
    }
    return failure
  }
  if (error.status === 400) return { key: 'notifications.errors.validation', params: { message: error.message } }
  if (error.status >= 500) return { key: 'login.errors.server' }
  return { key: 'login.errors.generic' }
}
