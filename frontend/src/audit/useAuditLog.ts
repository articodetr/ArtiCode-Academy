// State of the audit log table (MOD-03-T15): API-011 through the shared keyset
// hook (common/useKeysetList.ts, since J-F31) — filters, keyset pagination as
// a stack of cursors (ADR-039) and the current page. Every change of a filter
// restarts from the first page; in-flight requests are aborted.
import { useMemo } from 'react'
import { listAuditLogs } from '../api/audit'
import type { AuditLogItem } from '../api/audit'
import { useKeysetList } from '../common/useKeysetList'
import type { KeysetLoader } from '../common/useKeysetList'
import { DEFAULT_AUDIT_FILTERS, toListParams } from './audit.query'
import type { AuditFilters } from './audit.query'

const loadAuditLogs: KeysetLoader<AuditLogItem, AuditFilters> = (filters, cursor, signal) => listAuditLogs(toListParams(filters, cursor), signal)

export function useAuditLog(initialFilters: AuditFilters = DEFAULT_AUDIT_FILTERS) {
  const list = useKeysetList(loadAuditLogs, initialFilters)
  return useMemo(() => {
    // The log is append-only: no row on screen is ever replaced or removed.
    const { replaceItem: _replaceItem, removeItem: _removeItem, ...log } = list
    return log
  }, [list])
}
