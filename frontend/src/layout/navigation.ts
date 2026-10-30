import { createElement } from 'react'
import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  BookOutlined,
  CalendarOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FormOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { ROLES } from '../auth/roles'
import type { Role } from '../auth/roles'

/** What the navigation needs to know about the signed-in user (a subset of `AuthUser`). */
export interface NavViewer {
  /** UI role derived from the server roles; null when none of them is known (custom roles only). */
  role: Role | null
  /** Permission keys granted through the roles (ADR-023). */
  permissions: readonly string[]
}

interface NavItemBase {
  key: string
  path: string
  labelKey: string
  icon: ReactNode
  /** Documentation module this screen belongs to. */
  module: string
}

/**
 * A screen whose module has no server contract yet: shown by the role matrix of
 * docs §7.2 (`'everyone'` = every signed-in user, even one without a known role).
 */
interface RoleGatedItem extends NavItemBase {
  roles: readonly Role[] | 'everyone'
  permissions?: undefined
}

/**
 * A screen with a real API (MOD-03-T15): shown to a holder of ANY of these
 * permission keys, whatever the role — the same keys the server enforces, so the
 * role matrix neither hides a screen the server serves nor shows one it refuses.
 */
interface PermissionGatedItem extends NavItemBase {
  permissions: readonly string[]
  roles?: undefined
}

export type NavItem = RoleGatedItem | PermissionGatedItem

/** Every known UI role (not a user without one). */
const KNOWN_ROLES: readonly Role[] = ROLES

export const NAV_ITEMS: readonly NavItem[] = [
  // The landing page of every signed-in user (and the exit of the 403 page).
  { key: 'dashboard', path: '/', labelKey: 'nav.dashboard', icon: createElement(DashboardOutlined), roles: 'everyone', module: 'MOD-FE-01' },
  { key: 'users', path: '/users', labelKey: 'nav.users', icon: createElement(TeamOutlined), permissions: ['users.read'], module: 'MOD-03' },
  { key: 'roles', path: '/settings/roles', labelKey: 'nav.roles', icon: createElement(SafetyOutlined), permissions: ['roles.manage'], module: 'MOD-03' },
  { key: 'courses', path: '/courses', labelKey: 'nav.courses', icon: createElement(BookOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-04' },
  { key: 'classes', path: '/classes', labelKey: 'nav.classes', icon: createElement(AppstoreOutlined), roles: ['admin', 'teacher', 'staff'], module: 'MOD-05' },
  { key: 'schedule', path: '/schedule', labelKey: 'nav.schedule', icon: createElement(CalendarOutlined), roles: KNOWN_ROLES, module: 'MOD-07' },
  { key: 'lessons', path: '/lessons', labelKey: 'nav.lessons', icon: createElement(PlayCircleOutlined), roles: ['admin', 'teacher', 'student'], module: 'MOD-06' },
  { key: 'assignments', path: '/assignments', labelKey: 'nav.assignments', icon: createElement(FileTextOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-08' },
  { key: 'exams', path: '/exams', labelKey: 'nav.exams', icon: createElement(FormOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-09' },
  { key: 'certificates', path: '/certificates', labelKey: 'nav.certificates', icon: createElement(SafetyCertificateOutlined), roles: ['admin', 'student', 'guardian'], module: 'MOD-10' },
  { key: 'payments', path: '/payments', labelKey: 'nav.payments', icon: createElement(CreditCardOutlined), roles: ['admin', 'staff', 'student', 'guardian'], module: 'MOD-11' },
  { key: 'notifications', path: '/notifications', labelKey: 'nav.notifications', icon: createElement(BellOutlined), roles: KNOWN_ROLES, module: 'MOD-12' },
  { key: 'reports', path: '/reports', labelKey: 'nav.reports', icon: createElement(BarChartOutlined), roles: ['admin'], module: 'MOD-13' },
  { key: 'audit', path: '/audit-logs', labelKey: 'nav.audit', icon: createElement(AuditOutlined), permissions: ['audit.read'], module: 'MOD-03' },
  { key: 'settings', path: '/settings', labelKey: 'nav.settings', icon: createElement(SettingOutlined), roles: ['admin'], module: 'MOD-14' },
]

/** Whether the viewer sees an entry: by permission when the entry names keys, else by the role matrix. */
export function sees(item: NavItem, viewer: NavViewer): boolean {
  if (item.permissions) return item.permissions.some((key) => viewer.permissions.includes(key))
  if (item.roles === 'everyone') return true
  return viewer.role !== null && item.roles.includes(viewer.role)
}

export function navFor(viewer: NavViewer): NavItem[] {
  return NAV_ITEMS.filter((item) => sees(item, viewer))
}

/** UI-level gate behind `RequireAccess` (not a security boundary — the server enforces permissions). */
export function canAccess(viewer: NavViewer, navKey: string): boolean {
  const item = NAV_ITEMS.find((entry) => entry.key === navKey)
  return item ? sees(item, viewer) : false
}
