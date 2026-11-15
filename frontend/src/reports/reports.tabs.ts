// The tabs of the reports page and the key each needs (backend/src/reports/reports.policy.ts — the server
// checks the same keys; a tab the caller may not read is not shown).
export const REPORT_TABS = [
  { key: 'attendance', permission: 'reports.attendance.view' },
  { key: 'academic', permission: 'reports.academic.view' },
  { key: 'financial', permission: 'reports.financial.view' },
] as const

export type ReportTab = (typeof REPORT_TABS)[number]['key']

/** The tabs a caller sees, in page order. */
export function visibleReportTabs(has: (key: string) => boolean): ReportTab[] {
  return REPORT_TABS.filter((tab) => has(tab.permission)).map((tab) => tab.key)
}
