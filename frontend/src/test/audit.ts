// Fixtures for the audit log page (MOD-03-T15): API-011 shapes as the backend returns them.
import type { AuditLogItem, AuditLogList } from '../api/audit'

export const ADMIN_ID = 'user-1'
export const TARGET_ID = '0192f0a0-0000-7000-8000-000000000002'

export function makeAuditItem(overrides: Partial<AuditLogItem> = {}): AuditLogItem {
  return {
    id: '0192f0a0-0000-7000-8000-0000000000a1',
    action: 'users.status.changed',
    actorUserId: ADMIN_ID,
    entityType: 'users',
    entityId: TARGET_ID,
    metadata: { action: 'suspend', from: 'active', to: 'suspended', reason: 'late fees', revokedSessions: 2 },
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (test)',
    createdAt: '2026-10-30T09:15:00.000Z',
    ...overrides,
  }
}

export function makeAuditList(items: AuditLogItem[], nextCursor: string | null = null): AuditLogList {
  return { items, nextCursor }
}
