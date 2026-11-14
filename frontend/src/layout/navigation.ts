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
  EnvironmentOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FormOutlined,
  HomeOutlined,
  PercentageOutlined,
  PlayCircleOutlined,
  PlaySquareOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TeamOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import { ROLES } from '../auth/roles'
import type { Role } from '../auth/roles'

/** What the navigation needs to know about the signed-in user (a subset of `AuthUser`). */
export interface NavViewer {
  /** UI role derived from the server roles; null when none of them is known (custom roles only). */
  role: Role | null
  /** Server role keys the user holds (e.g. `student`, `guardian`), for the entries gated by `roleKeys`. */
  roles: readonly string[]
  /** Permission keys granted through the roles (ADR-023). */
  permissions: readonly string[]
}

/**
 * The menu sections, in the order the side menu shows them (redesign, 2026-11-14): an entry's place
 * inside its section follows NAV_ITEMS.
 */
export const NAV_GROUPS = ['home', 'teaching', 'people', 'finance', 'academy'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

interface NavItemBase {
  key: string
  /** The side-menu section the entry belongs to. */
  group: NavGroup
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
  roleKeys?: undefined
  exceptRoleKeysOnly?: undefined
}

/**
 * A screen with a real API (MOD-03-T15): shown to a holder of ANY of these
 * permission keys, whatever the role — the same keys the server enforces, so the
 * role matrix neither hides a screen the server serves nor shows one it refuses.
 */
interface PermissionGatedItem extends NavItemBase {
  permissions: readonly string[]
  /**
   * Hidden from a viewer every one of whose server role keys is in this list,
   * whatever the permissions (J-F38): learners hold `assignments.read` (and
   * `exams.read` — J-F45) by seed but are assigned to no class, so API-102 (and
   * API-113) answer them an empty list (D-R16, D-R40, D-R48) — their own work
   * comes through ownership instead. A viewer holding any other role key (a
   * teacher who is also a guardian) keeps the entry.
   */
  exceptRoleKeysOnly?: readonly string[]
  roles?: undefined
  roleKeys?: undefined
}

/**
 * A screen served by ownership, without a permission key (J-F04 — «my classes»,
 * API-060; J-F11 — «my lessons», API-101; J-F42 — «my assignments», API-112): shown to a user holding ANY of these server role keys — the rule the
 * server applies (`seesChildren()` looks at the `guardian` key, a student's
 * enrollments follow the `student` role), not the single UI role, so a teacher
 * who is also a guardian still sees it.
 */
interface RoleKeyGatedItem extends NavItemBase {
  roleKeys: readonly string[]
  roles?: undefined
  permissions?: undefined
  exceptRoleKeysOnly?: undefined
}

export type NavItem = RoleGatedItem | PermissionGatedItem | RoleKeyGatedItem

/** Every known UI role (not a user without one). */
const KNOWN_ROLES: readonly Role[] = ROLES

export const NAV_ITEMS: readonly NavItem[] = [
  // The landing page of every signed-in user (and the exit of the 403 page).
  { key: 'dashboard', group: 'home', path: '/', labelKey: 'nav.dashboard', icon: createElement(DashboardOutlined), roles: 'everyone', module: 'MOD-FE-01' },
  { key: 'users', group: 'people', path: '/users', labelKey: 'nav.users', icon: createElement(TeamOutlined), permissions: ['users.read'], module: 'MOD-03' },
  // MOD-04-T05 (CH-0047): gated by the key the server enforces (ADR-042 pattern) — staff see it too.
  { key: 'courses', group: 'teaching', path: '/courses', labelKey: 'nav.courses', icon: createElement(BookOutlined), permissions: ['courses.read'], exceptRoleKeysOnly: ['student', 'guardian'], module: 'MOD-04' },
  // MOD-05 (J-F01): the classes API is real — gated by the one key every read of `/api/classes` requires
  // (`classes.read` at controller level; `classes.manage` only adds writes, so alone it would get a 403 on the list —
  // owner review of PR #26). A teacher (classes.read) sees only assigned classes (D-R16).
  { key: 'classes', group: 'teaching', path: '/classes', labelKey: 'nav.classes', icon: createElement(AppstoreOutlined), permissions: ['classes.read'], module: 'MOD-05' },
  // MOD-05 (J-F04): «my classes» (API-060) needs no permission key — ownership; shown to whoever holds the
  // `student` or `guardian` server role, as the server reads them (an admin or a teacher alone gets an empty list).
  { key: 'myClasses', group: 'teaching', path: '/my-classes', labelKey: 'nav.myClasses', icon: createElement(ReadOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-05' },
  // MOD-07 (J-F05): the schedule API is real — «my schedule» needs `schedule.read` (every seeded role holds it) and the
  // academy view `schedule.manage` or `classes.manage` (D-R27); any of the three shows the entry (ADR-042 pattern).
  { key: 'schedule', group: 'teaching', path: '/schedule', labelKey: 'nav.schedule', icon: createElement(CalendarOutlined), permissions: ['schedule.read', 'schedule.manage', 'classes.manage'], module: 'MOD-07' },
  // MOD-06 (J-F09): the lessons API is real — gated by the one key every read of `/api/lessons` requires (`lessons.read` at
  // controller level; `lessons.manage` only adds writes). Staff gain the entry (the seed grants them lessons.read); a student
  // holds it too but is assigned to no class, so the server answers an empty list there — their own lessons are in «my lessons».
  { key: 'lessons', group: 'teaching', path: '/lessons', labelKey: 'nav.lessons', icon: createElement(PlayCircleOutlined), permissions: ['lessons.read'], exceptRoleKeysOnly: ['student', 'guardian'], module: 'MOD-06' },
  // MOD-06 (J-F11): «my lessons» (API-101) needs no permission key — ownership, the API-060 rule; shown to whoever holds the
  // `student` or `guardian` server role, like «my classes» (a teacher who is also a guardian keeps it; a teacher or an admin
  // alone gets no entry — the server would answer an empty list, and the lessons they teach are on /lessons).
  { key: 'myLessons', group: 'teaching', path: '/my-lessons', labelKey: 'nav.myLessons', icon: createElement(PlaySquareOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-06' },
  // MOD-08 (J-F38): the assignments API is real — gated by the one key every read of `/api/assignments` requires
  // (`assignments.read` at controller level; `assignments.manage` only adds writes), with the learners excepted (roadmap
  // §4g T06): students and guardians hold the key by seed but are assigned to no class, so the list would stay empty —
  // their own assignments come with «my assignments» (API-112, MOD-08-T04). Staff hold no assignments.* key (matrix 7.2).
  {
    key: 'assignments', group: 'teaching',
    path: '/assignments',
    labelKey: 'nav.assignments',
    icon: createElement(FileTextOutlined),
    permissions: ['assignments.read'],
    exceptRoleKeysOnly: ['student', 'guardian'],
    module: 'MOD-08',
  },
  // MOD-08 (J-F42): «my assignments» (API-112) needs no permission key — ownership, the API-060 rule (D-R40); shown to whoever
  // holds the `student` or `guardian` server role, like «my lessons» (a teacher who is also a guardian keeps it next to
  // «assignments»; a teacher or an admin alone gets no entry — the server would answer an empty list). Submitting from the
  // page needs `assignments.submit` on top (the student's seed key); a guardian reads and never submits.
  { key: 'myAssignments', group: 'teaching', path: '/my-assignments', labelKey: 'nav.myAssignments', icon: createElement(FileDoneOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-08' },
  // MOD-09 (J-F50): «my exams» (API-121) needs no permission key — ownership, the API-060 rule (D-R48, as «my assignments»);
  // «my grades» (API-129) adds the keys of matrix 7.2 to the same ownership (grades.read_own for one's own enrollments,
  // grades.read_linked for the children's) and answers 403 to a caller holding neither. Both follow the `student` and
  // `guardian` server role keys like the other learner pages (a teacher who is also a guardian keeps them; a teacher or an
  // admin alone gets no entry); a learner role that lost both grades keys still reaches «my grades», which words the refusal.
  { key: 'myExams', group: 'teaching', path: '/my-exams', labelKey: 'nav.myExams', icon: createElement(ScheduleOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-09' },
  { key: 'myGrades', group: 'teaching', path: '/my-grades', labelKey: 'nav.myGrades', icon: createElement(TrophyOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-09' },
  // MOD-10 (J-F51): «my certificates» (API-135) — ownership with the 7.2 keys (`certificates.read_own` for one's own,
  // `certificates.read_linked` with the guardian role for a child's — D-R57); shown to whoever holds the `student` or
  // `guardian` server role key, like «my assignments» (MOD-12 notifications link here). A learner whose role lost both
  // keys reaches the page and gets the server's 403 message.
  { key: 'myCertificates', group: 'teaching', path: '/my-certificates', labelKey: 'nav.myCertificates', icon: createElement(TrophyOutlined), roleKeys: ['student', 'guardian'], module: 'MOD-10' },
  // MOD-09 (J-F45): the exams API is real — gated by the one key every read of `/api/exams` requires (`exams.read` at
  // controller level; `exams.manage` and `exams.grade` only add writes), with the learners excepted like «assignments»:
  // students and guardians hold the key by seed but are assigned to no class, so the list would stay empty — their own exams
  // come with «my exams» (API-121, a later part of MOD-09-T08). Staff hold no exams.* key (matrix 7.2).
  {
    key: 'exams', group: 'teaching',
    path: '/exams',
    labelKey: 'nav.exams',
    icon: createElement(FormOutlined),
    permissions: ['exams.read'],
    exceptRoleKeysOnly: ['student', 'guardian'],
    module: 'MOD-09',
  },
  // MOD-10 (J-F51): the certificates API is real — the list, the details and a class's preview open with
  // `certificates.read_all` OR `certificates.issue` (D-R57: staff issue without read_all), so either key shows the entry.
  // No learner holds either by seed (they read theirs in «my certificates»), so nobody is excepted; teachers hold none.
  { key: 'certificates', group: 'people', path: '/certificates', labelKey: 'nav.certificates', icon: createElement(SafetyCertificateOutlined), permissions: ['certificates.read_all', 'certificates.issue'], module: 'MOD-10' },
  // MOD-11 (redesign, 2026-11-14): the payments screen is real — the office view opens with any office key the
  // server checks (invoices.read_all / invoices.manage / payments.record), «my invoices» (API-155) with
  // invoices.read_own / invoices.read_linked; any of them shows the entry, whatever the role.
  {
    key: 'payments',
    group: 'finance',
    path: '/payments',
    labelKey: 'nav.payments',
    icon: createElement(CreditCardOutlined),
    permissions: ['invoices.read_all', 'invoices.manage', 'payments.record', 'invoices.read_own', 'invoices.read_linked'],
    module: 'MOD-11',
  },
  { key: 'notifications', group: 'home', path: '/notifications', labelKey: 'nav.notifications', icon: createElement(BellOutlined), roles: KNOWN_ROLES, module: 'MOD-12' },
  // MOD-13 (redesign, 2026-11-14): the reports screen is real — each tab needs its own key, any one shows the entry
  // (seeded staff hold the attendance and financial ones).
  {
    key: 'reports',
    group: 'finance',
    path: '/reports',
    labelKey: 'nav.reports',
    icon: createElement(BarChartOutlined),
    permissions: ['reports.attendance.view', 'reports.academic.view', 'reports.financial.view'],
    module: 'MOD-13',
  },
  // MOD-02/MOD-14 minimum (CH-0036): the general tab is real, so the entry moved from the role matrix to the
  // catalog keys (either one shows it; saving needs `manage`). By default only academy_admin holds them — no visible change.
  { key: 'settings', group: 'academy', path: '/settings', labelKey: 'nav.settings', icon: createElement(SettingOutlined), permissions: ['academy.settings.read', 'academy.settings.manage'], module: 'MOD-14' },
  // MOD-02-T06 screen: the branches tab of the settings lives under /settings/branches behind the one key the server enforces for writes.
  { key: 'branches', group: 'academy', path: '/settings/branches', labelKey: 'nav.branches', icon: createElement(EnvironmentOutlined), permissions: ['branches.manage'], module: 'MOD-02' },
  // J-F06 (MOD-07-T02 screen): the rooms tab of the settings lives under /settings/rooms behind the one key the server
  // enforces for writes (`schedule.manage` — reads need no key, D-R27; by seed only academy_admin holds it).
  { key: 'rooms', group: 'academy', path: '/settings/rooms', labelKey: 'nav.rooms', icon: createElement(HomeOutlined), permissions: ['schedule.manage'], module: 'MOD-07' },
  // J-F44 (MOD-09-T08 part a): the grade schemes tab of the settings lives under /settings/grade-schemes behind the one key
  // every write of /api/grade-schemes requires (`academy.settings.manage` — reads need none, D-R46; by seed only academy_admin
  // holds it). The `settings` entry above opens with `academy.settings.read` too; this one is management only.
  {
    key: 'gradeSchemes', group: 'academy',
    path: '/settings/grade-schemes',
    labelKey: 'nav.gradeSchemes',
    icon: createElement(PercentageOutlined),
    permissions: ['academy.settings.manage'],
    module: 'MOD-09',
  },
  // The academy section ends with the people-and-access tools: roles (MOD-03-T13) and the audit log (MOD-03-T15).
  { key: 'roles', group: 'academy', path: '/settings/roles', labelKey: 'nav.roles', icon: createElement(SafetyOutlined), permissions: ['roles.manage'], module: 'MOD-03' },
  { key: 'audit', group: 'academy', path: '/audit-logs', labelKey: 'nav.audit', icon: createElement(AuditOutlined), permissions: ['audit.read'], module: 'MOD-03' },
]

/** True when the viewer holds at least one server role key and every one of them is in `keys`. */
function holdsOnly(viewer: NavViewer, keys: readonly string[]): boolean {
  return viewer.roles.length > 0 && viewer.roles.every((key) => keys.includes(key))
}

/**
 * Whether the viewer sees an entry: by permission when the entry names keys (unless every role key the viewer holds
 * is one the entry excepts), by server role keys when it names those, else by the role matrix.
 */
export function sees(item: NavItem, viewer: NavViewer): boolean {
  if (item.permissions) {
    if (item.exceptRoleKeysOnly && holdsOnly(viewer, item.exceptRoleKeysOnly)) return false
    return item.permissions.some((key) => viewer.permissions.includes(key))
  }
  if (item.roleKeys) return item.roleKeys.some((key) => viewer.roles.includes(key))
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
