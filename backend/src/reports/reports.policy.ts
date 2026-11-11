// MOD-13 permission keys and limits (roadmap §4k.3; owner decisions D-R68,
// D-R69 and D-R72). Academy-wide: a key holder reads every class (no class
// visibility — D-R68); the seed is unchanged (staff: attendance + financial,
// academy_admin: all three).

export const REPORTS_ATTENDANCE_PERMISSION = 'reports.attendance.view';
export const REPORTS_ACADEMIC_PERMISSION = 'reports.academic.view';
export const REPORTS_FINANCIAL_PERMISSION = 'reports.financial.view';
/** The overview (API-164) opens with any of the three; each section needs its own (D-R67). */
export const REPORT_PERMISSIONS = [REPORTS_ATTENDANCE_PERMISSION, REPORTS_ACADEMIC_PERMISSION, REPORTS_FINANCIAL_PERMISSION] as const;

/** API-164: the keys to name in `permission_denied` when the caller holds none of the three, else null. */
export function reportsMissing(permissions: readonly string[]): string[] | null {
  return REPORT_PERMISSIONS.some((key) => permissions.includes(key)) ? null : [...REPORT_PERMISSIONS];
}

/** D-R72: the most rows one report returns; more are cut and `truncated` is true. */
export const ROW_CAP = 5_000;
/** D-R69: the longest period, in inclusive days. */
export const MAX_PERIOD_DAYS = 366;
/** D-R69: the default period, in inclusive days, ending today in the academy's zone. */
export const DEFAULT_PERIOD_DAYS = 30;
