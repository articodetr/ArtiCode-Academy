// Academy-level roles (ROLE-02 .. ROLE-06 in docs/PROJECT_DOCUMENTATION.md §7.2).
// Super Admin (ROLE-01) is platform-level and intentionally absent (ADR-022).

export const ROLES = ['admin', 'teacher', 'student', 'guardian', 'staff'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Server role keys (roles.key, seeded by backend/src/authorization/system-roles.ts) → UI role. */
const SERVER_ROLE_TO_UI: Readonly<Record<string, Role>> = {
  academy_admin: 'admin',
  teacher: 'teacher',
  student: 'student',
  guardian: 'guardian',
  staff: 'staff',
}

/** The UI role a single server role key maps to, or null for custom/unknown keys. */
export function uiRoleFor(serverRoleKey: string): Role | null {
  return SERVER_ROLE_TO_UI[serverRoleKey] ?? null
}

/** When a user holds several roles, the widest view wins. */
const PRECEDENCE: readonly Role[] = ['admin', 'staff', 'teacher', 'guardian', 'student']

/** The UI role that drives navigation for a user, or null when none of their roles is known. */
export function primaryRole(serverRoleKeys: readonly string[]): Role | null {
  const held = new Set(serverRoleKeys.map((key) => SERVER_ROLE_TO_UI[key]).filter(isRole))
  return PRECEDENCE.find((role) => held.has(role)) ?? null
}
