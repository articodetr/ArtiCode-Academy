// The quick actions of the admin home (J-F59, the «Admin Dashboard Modern Redesign» spec): large cards that open an
// existing page, each shown only to a viewer the page itself would serve — the menu's own gate (`canAccess()` of
// layout/navigation.ts, the keys the server enforces) plus, for an action that creates, the key that shows that page's
// own «add» button (no «add» card for a read-only viewer). Every destination is an existing route; the creation links
// (`?create=`) open the existing creation forms (common/useCreateFromLink.ts). The server stays the boundary.
import {
  AppstoreTwoTone,
  BookTwoTone,
  CalendarTwoTone,
  CarryOutTwoTone,
  ContactsTwoTone,
  CreditCardTwoTone,
  FileTextTwoTone,
  IdcardTwoTone,
  InteractionTwoTone,
  PlayCircleTwoTone,
  ReconciliationTwoTone,
  SafetyCertificateTwoTone,
} from '@ant-design/icons'
import { CREATE_COURSE, createLink } from '../../common/useCreateFromLink'
import { canAccess } from '../../layout/navigation'
import type { NavViewer } from '../../layout/navigation'
import { paymentsViewOf } from '../../payments/payments.format'

export const QUICK_ACTION_KEYS = [
  'addStudent',
  'addTeacher',
  'createCourse',
  'classes',
  'assignTeacher',
  'lessons',
  'schedule',
  'enrollmentRequests',
  'assignments',
  'exams',
  'payments',
  'certificates',
] as const
export type QuickActionKey = (typeof QUICK_ACTION_KEYS)[number]

/** Every action icon is a two-tone antd icon, drawn in the academy's blue and gold (admin.tones.ts). */
export type QuickActionIcon = typeof IdcardTwoTone

export interface QuickAction {
  key: QuickActionKey
  /** The page it opens (an existing route, with `?create=` for a creation form). */
  to: string
  icon: QuickActionIcon
}

type HasPermission = (key: string) => boolean

interface QuickActionRule extends QuickAction {
  allowed: (viewer: NavViewer, has: HasPermission) => boolean
}

const RULES: readonly QuickActionRule[] = [
  // /users needs users.read (the menu's gate); creating needs users.create — the page's add button (API-014).
  { key: 'addStudent', to: createLink('/users', 'student'), icon: IdcardTwoTone, allowed: (viewer, has) => canAccess(viewer, 'users') && has('users.create') },
  { key: 'addTeacher', to: createLink('/users', 'teacher'), icon: ContactsTwoTone, allowed: (viewer, has) => canAccess(viewer, 'users') && has('users.create') },
  // /courses needs courses.read; creating needs courses.manage (API-044).
  { key: 'createCourse', to: createLink('/courses', CREATE_COURSE), icon: BookTwoTone, allowed: (viewer, has) => canAccess(viewer, 'courses') && has('courses.manage') },
  { key: 'classes', to: '/classes', icon: AppstoreTwoTone, allowed: (viewer) => canAccess(viewer, 'classes') },
  // A class's teachers are assigned from its drawer on /classes (API-056, classes.teachers.assign).
  { key: 'assignTeacher', to: '/classes', icon: InteractionTwoTone, allowed: (viewer, has) => canAccess(viewer, 'classes') && has('classes.teachers.assign') },
  { key: 'lessons', to: '/lessons', icon: PlayCircleTwoTone, allowed: (viewer) => canAccess(viewer, 'lessons') },
  { key: 'schedule', to: '/schedule', icon: CalendarTwoTone, allowed: (viewer) => canAccess(viewer, 'schedule') },
  { key: 'enrollmentRequests', to: '/enrollment-requests', icon: ReconciliationTwoTone, allowed: (viewer) => canAccess(viewer, 'enrollmentRequests') },
  { key: 'assignments', to: '/assignments', icon: FileTextTwoTone, allowed: (viewer) => canAccess(viewer, 'assignments') },
  { key: 'exams', to: '/exams', icon: CarryOutTwoTone, allowed: (viewer) => canAccess(viewer, 'exams') },
  // The office view of /payments (an invoice read key); a learner's «my invoices» is not an admin action.
  { key: 'payments', to: '/payments', icon: CreditCardTwoTone, allowed: (viewer, has) => canAccess(viewer, 'payments') && paymentsViewOf(has) === 'office' },
  { key: 'certificates', to: '/certificates', icon: SafetyCertificateTwoTone, allowed: (viewer) => canAccess(viewer, 'certificates') },
]

/** The actions this viewer may use, in the spec's order. */
export function quickActionsFor(viewer: NavViewer, has: HasPermission): QuickAction[] {
  return RULES.filter((rule) => rule.allowed(viewer, has)).map(({ key, to, icon }) => ({ key, to, icon }))
}

/** How many actions a phone shows before «show more» (the rest stay one tap away). */
export const PHONE_VISIBLE_ACTIONS = 6
