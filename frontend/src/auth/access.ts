// Pure access rule behind RequireAccess (MOD-03-T15), shared with any
// component that hides parts of a page. UI-level only — the server enforces.
import { canAccess } from '../layout/navigation'
import type { AuthUser } from './auth-context'
import type { Role } from './roles'

/**
 * What a screen asks of the signed-in user. Every given criterion must hold;
 * with none given any signed-in user passes.
 */
export interface AccessRule {
  /** Entry of `NAV_ITEMS` whose own rule decides (permission keys, or the role matrix). */
  navKey?: string
  /** A permission key the user must hold. */
  permission?: string
  /** A UI role (or one of several) the user must have. */
  role?: Role | readonly Role[]
}

export function isAllowed(user: Pick<AuthUser, 'role' | 'permissions'>, rule: AccessRule): boolean {
  if (rule.navKey !== undefined && !canAccess(user, rule.navKey)) return false
  if (rule.permission !== undefined && !user.permissions.includes(rule.permission)) return false
  if (rule.role !== undefined) {
    const roles = typeof rule.role === 'string' ? [rule.role] : rule.role
    if (user.role === null || !roles.includes(user.role)) return false
  }
  return true
}
