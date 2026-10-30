// Audit log read API (MOD-03-T15 on the T10 contract API-011 GET /api/audit-logs).
// Types mirror backend/src/audit/audit.dto.ts; the call goes through apiRequest
// (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'

/** `AuditLogItemDto`: one event as the server recorded it (metadata holds identifiers and non-sensitive values only). */
export interface AuditLogItem {
  id: string
  /** Dotted event name, e.g. `users.status.changed` (dictionary in docs 12.4). */
  action: string
  /** Null for system actions (bootstrap) and the self-service reset request. */
  actorUserId: string | null
  /** Table name the event is about (`users`, `roles`), or null. */
  entityType: string | null
  entityId: string | null
  metadata: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export interface AuditLogList {
  /** Newest first (insertion order — the UUIDv7 primary key). */
  items: AuditLogItem[]
  /** Pass as `cursor` with the same filters to fetch the next (older) page; null when exhausted. */
  nextCursor: string | null
}

/** Query of API-011; every criterion is ANDed by the server. */
export interface ListAuditLogsParams {
  /** Event-name prefix, matched literally (`users.` = every users event). */
  action?: string
  actorUserId?: string
  /** Required by the server when `entityId` is given. */
  entityType?: string
  entityId?: string
  /** ISO 8601: events created strictly before this instant. */
  before?: string
  /** 1–200, server default 50. */
  limit?: number
  cursor?: string
}

export const AUDIT_PATHS = {
  list: '/api/audit-logs',
} as const

/** Query string of API-011: blank text parameters are left out. */
export function auditLogsPath(params: ListAuditLogsParams = {}): string {
  const search = new URLSearchParams()
  const text = (key: 'action' | 'actorUserId' | 'entityType' | 'entityId' | 'before' | 'cursor') => {
    const value = params[key]?.trim()
    if (value) search.set(key, value)
  }
  text('action')
  text('actorUserId')
  text('entityType')
  text('entityId')
  text('before')
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  text('cursor')
  const query = search.toString()
  return query ? `${AUDIT_PATHS.list}?${query}` : AUDIT_PATHS.list
}

export function listAuditLogs(params: ListAuditLogsParams = {}, signal?: AbortSignal): Promise<AuditLogList> {
  return apiRequest<AuditLogList>(auditLogsPath(params), { signal })
}
