// Pure helpers of the audit log page (MOD-03-T15): the filter form values,
// their local validation (mirrors of backend/src/audit/audit.query.ts so an
// invalid value never reaches the server) and the query of API-011.
import type { ListAuditLogsParams } from '../api/audit'

/** Event names are dotted lower-case segments; the filter is a literal prefix of one, 1–64 characters. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/
/** Entity types are table names (`users`, `roles`). */
export const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
export const ENTITY_ID_MAX_LENGTH = 128
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Page sizes offered; API-011 allows 1–200 and defaults to 50. */
export const AUDIT_PAGE_SIZES = [20, 50, 100, 200] as const
export type AuditPageSize = (typeof AUDIT_PAGE_SIZES)[number]

/** Values of the filter form (blank = absent); `before` is the value of an `<input type="datetime-local">`. */
export interface AuditFilterValues {
  action: string
  actorUserId: string
  entityType: string
  entityId: string
  before: string
}

export interface AuditFilters extends AuditFilterValues {
  limit: AuditPageSize
}

export const EMPTY_FILTER_VALUES: AuditFilterValues = { action: '', actorUserId: '', entityType: '', entityId: '', before: '' }

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { ...EMPTY_FILTER_VALUES, limit: 50 }

/**
 * Event families and names of the dictionary in docs 12.4, offered as
 * suggestions for the `action` prefix (any literal prefix is accepted).
 */
export const AUDIT_ACTION_SUGGESTIONS: readonly string[] = [
  'auth.',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.login.locked',
  'auth.login.rejected',
  'auth.refresh.reuse_detected',
  'auth.logout',
  'auth.logout_all',
  'auth.password.changed',
  'auth.password.reset',
  'auth.bootstrap.admin_created',
  'users.',
  'users.created',
  'users.updated',
  'users.deleted',
  'users.invitation.',
  'users.invitation.issued',
  'users.invitation.accepted',
  'users.password_reset.issued',
  'users.status.changed',
  'users.roles.changed',
  'roles.',
  'roles.created',
  'roles.updated',
  'roles.permissions.changed',
  'roles.deleted',
  'guardians.',
  'guardians.linked',
  'guardians.updated',
  'guardians.unlinked',
  'academy.',
  'academy.updated',
  // MOD-02-T06 (CH-0089)
  'branches.',
  'branches.created',
  'branches.updated',
  'branches.deleted',
  // MOD-04-T02 (CH-0044)
  'levels.',
  'levels.created',
  'levels.updated',
  'levels.deleted',
  'levels.reordered',
  // MOD-04-T03 (CH-0045)
  'courses.',
  'courses.created',
  'courses.updated',
  'courses.status.changed',
  'courses.deleted',
  // MOD-04-T04 (CH-0050) — first offered in the frontend with O7-F (CH-0067)
  'courses.syllabus.changed',
  // MOD-05-T02/T03 (CH-0053, CH-0054)
  'classes.',
  'classes.created',
  'classes.updated',
  'classes.status.changed',
  'classes.deleted',
  'classes.teachers.changed',
  // MOD-05-T04 (CH-0055) — first shown in the frontend with J-F04
  'enrollments.',
  'enrollments.created',
  'enrollments.status.changed',
  // MOD-07-T02/T03 (CH-0095, CH-0096) — first offered with J-F05 (CH-0105)
  'rooms.',
  'rooms.created',
  'rooms.updated',
  'rooms.deleted',
  'classes.schedule.changed',
  // MOD-06-T02 (CH-0101) — first offered with J-F05 (CH-0105)
  'lessons.',
  'lessons.created',
  'lessons.updated',
  'lessons.status.changed',
  'lessons.deleted',
  // MOD-06-T03 (CH-0102) — first offered with J-F10 (CH-0062)
  'attendance.',
  'attendance.recorded',
  // MOD-08-T02 (CH-0116) — first offered with J-F38 (CH-0152)
  'assignments.',
  'assignments.created',
  'assignments.updated',
  'assignments.status.changed',
  'assignments.deleted',
  // MOD-08-T03 (CH-0117) — first offered with J-F41 (CH-0155)
  'assignments.submitted',
  'assignments.graded',
  'assignments.returned',
  // MOD-09-T02 (CH-0126) — first offered with J-F44 (CH-0158)
  'grade_schemes.',
  'grade_schemes.created',
  'grade_schemes.updated',
  'grade_schemes.deleted',
  // MOD-09-T05 (CH-0170) — first offered with J-F49 (CH-0163)
  'grades.',
  'grades.finalized',
  'grades.withdrawn',
  // MOD-09-T03/T04 (CH-0127, CH-0129) — first offered with J-F45 (CH-0159)
  'exams.',
  'exams.created',
  'exams.updated',
  'exams.status.changed',
  'exams.deleted',
  'exams.results.recorded',
  // MOD-10-T02/T03 (CH-0176, CH-0177) — first offered with J-F51 (CH-0165)
  'certificates.',
  'certificates.issued',
  'certificates.revoked',
  // MOD-11 finance (redesign — the real payments screen, 2026-11-14); names from backend/src/finance/*.service.ts.
  'fee_plans.',
  'fee_plans.created',
  'fee_plans.updated',
  'fee_plans.deleted',
  'invoices.',
  'invoices.created',
  'invoices.updated',
  'invoices.deleted',
  'invoices.issued',
  'invoices.cancelled',
  'invoices.batch_created',
  'payments.',
  'payments.recorded',
  'payments.reversed',
  // MOD-12: the one event an announcement records (marks and preferences record none).
  'notifications.announcement.sent',
]

/** Translation keys of the problems of a filter set, by field; empty when the server would accept it. */
export function validateAuditFilters(values: AuditFilterValues): Partial<Record<keyof AuditFilterValues, string>> {
  const problems: Partial<Record<keyof AuditFilterValues, string>> = {}
  const action = values.action.trim()
  if (action && !AUDIT_ACTION_PATTERN.test(action)) problems.action = 'audit.validation.action'
  const actor = values.actorUserId.trim()
  if (actor && !UUID_PATTERN.test(actor)) problems.actorUserId = 'audit.validation.uuid'
  const entityType = values.entityType.trim()
  const entityId = values.entityId.trim()
  if (entityType && !ENTITY_TYPE_PATTERN.test(entityType)) problems.entityType = 'audit.validation.entityType'
  if (entityId && !entityType) problems.entityType = 'audit.validation.entityTypeRequired'
  if (entityId.length > ENTITY_ID_MAX_LENGTH) problems.entityId = 'audit.validation.entityIdMax'
  if (values.before.trim() && beforeToIso(values.before) === undefined) problems.before = 'audit.validation.before'
  return problems
}

/** `<input type="datetime-local">` value (local time) → ISO 8601 in UTC; blank or invalid → undefined. */
export function beforeToIso(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Query of API-011 for a page: trimmed values, blanks dropped, `before` as ISO 8601. */
export function toListParams(filters: AuditFilters, cursor?: string): ListAuditLogsParams {
  const params: ListAuditLogsParams = { limit: filters.limit }
  const action = filters.action.trim()
  if (action) params.action = action
  const actor = filters.actorUserId.trim()
  if (actor) params.actorUserId = actor
  const entityType = filters.entityType.trim()
  if (entityType) params.entityType = entityType
  const entityId = filters.entityId.trim()
  if (entityId) params.entityId = entityId
  const before = beforeToIso(filters.before)
  if (before) params.before = before
  if (cursor) params.cursor = cursor
  return params
}

/** Whether any filter (other than the page size) is set. */
export function hasActiveFilters(filters: AuditFilterValues): boolean {
  return Boolean(filters.action.trim() || filters.actorUserId.trim() || filters.entityType.trim() || filters.entityId.trim() || filters.before.trim())
}
