import { createElement } from 'react'
import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
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
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { ROLES } from '../auth/roles'
import type { Role } from '../auth/roles'

export interface NavItem {
  key: string
  path: string
  labelKey: string
  icon: ReactNode
  /** Roles that see this entry. Proposed matrix from docs §7.2; UI-only until MOD-01/MOD-03 exist. */
  roles: readonly Role[]
  /** Documentation module this screen belongs to. */
  module: string
}

const ALL: readonly Role[] = ROLES

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', path: '/', labelKey: 'nav.dashboard', icon: createElement(DashboardOutlined), roles: ALL, module: 'MOD-FE-01' },
  { key: 'users', path: '/users', labelKey: 'nav.users', icon: createElement(TeamOutlined), roles: ['admin', 'staff'], module: 'MOD-03' },
  { key: 'courses', path: '/courses', labelKey: 'nav.courses', icon: createElement(BookOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-04' },
  { key: 'classes', path: '/classes', labelKey: 'nav.classes', icon: createElement(AppstoreOutlined), roles: ['admin', 'teacher', 'staff'], module: 'MOD-05' },
  { key: 'schedule', path: '/schedule', labelKey: 'nav.schedule', icon: createElement(CalendarOutlined), roles: ALL, module: 'MOD-07' },
  { key: 'lessons', path: '/lessons', labelKey: 'nav.lessons', icon: createElement(PlayCircleOutlined), roles: ['admin', 'teacher', 'student'], module: 'MOD-06' },
  { key: 'assignments', path: '/assignments', labelKey: 'nav.assignments', icon: createElement(FileTextOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-08' },
  { key: 'exams', path: '/exams', labelKey: 'nav.exams', icon: createElement(FormOutlined), roles: ['admin', 'teacher', 'student', 'guardian'], module: 'MOD-09' },
  { key: 'certificates', path: '/certificates', labelKey: 'nav.certificates', icon: createElement(SafetyCertificateOutlined), roles: ['admin', 'student', 'guardian'], module: 'MOD-10' },
  { key: 'payments', path: '/payments', labelKey: 'nav.payments', icon: createElement(CreditCardOutlined), roles: ['admin', 'staff', 'student', 'guardian'], module: 'MOD-11' },
  { key: 'notifications', path: '/notifications', labelKey: 'nav.notifications', icon: createElement(BellOutlined), roles: ALL, module: 'MOD-12' },
  { key: 'reports', path: '/reports', labelKey: 'nav.reports', icon: createElement(BarChartOutlined), roles: ['admin'], module: 'MOD-13' },
  { key: 'settings', path: '/settings', labelKey: 'nav.settings', icon: createElement(SettingOutlined), roles: ['admin'], module: 'MOD-14' },
]

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

export function canAccess(role: Role, navKey: string): boolean {
  const item = NAV_ITEMS.find((entry) => entry.key === navKey)
  return item ? item.roles.includes(role) : false
}
