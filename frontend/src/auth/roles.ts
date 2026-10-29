// Academy-level roles (ROLE-02 .. ROLE-06 in docs/PROJECT_DOCUMENTATION.md §7.2).
// Super Admin (ROLE-01) is platform-level and intentionally absent until ADR-008 is decided.

export const ROLES = ['admin', 'teacher', 'student', 'guardian', 'staff'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
