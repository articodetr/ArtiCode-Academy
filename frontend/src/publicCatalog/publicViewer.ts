// Who looks at the academy's public pages (PORTAL-04, #208) and where each of
// their links leads — pure rules, unit-tested in publicViewer.test.ts:
// - `pending` while the session is still being restored (no sign-in or
//   «مدرستي» button yet, so neither flashes);
// - `visitor` without a session: the public catalog (/explore) and the sign-in page;
// - `learner` = a signed-in user holding the `student` or `guardian` role key
//   (the nav entry `catalog`): the signed-in catalog (/catalog) and «مدرستي»;
// - `staff` = any other signed-in user: the dashboard (/) and the courses page
//   (/courses) — never the learners' catalog, which would answer 403.
// The server stays the boundary: these rules only choose a link.
import type { AuthStatus, AuthUser } from '../auth/auth-context'

export type PublicViewer = 'pending' | 'visitor' | 'learner' | 'staff'

const LEARNER_ROLE_KEYS: readonly string[] = ['student', 'guardian']

/** True for a user who reads the signed-in catalog (the `student`/`guardian` role keys). */
export function isLearner(user: Pick<AuthUser, 'roles'> | null | undefined): boolean {
  return user?.roles.some((role) => LEARNER_ROLE_KEYS.includes(role)) ?? false
}

export function viewerOf(status: AuthStatus, user: Pick<AuthUser, 'roles'> | null): PublicViewer {
  if (status === 'loading') return 'pending'
  if (status !== 'authenticated' || !user) return 'visitor'
  return isLearner(user) ? 'learner' : 'staff'
}

/** Where «البرامج» / «كل البرامج» leads. */
export function programsPathFor(viewer: PublicViewer): string {
  if (viewer === 'learner') return '/catalog'
  if (viewer === 'staff') return '/courses'
  return '/explore'
}

/** Where a course card's «التفاصيل» leads. */
export function coursePathFor(viewer: PublicViewer, courseId: string): string {
  const id = encodeURIComponent(courseId)
  if (viewer === 'learner') return `/catalog/${id}`
  if (viewer === 'staff') return '/courses'
  return `/explore/${id}`
}

/**
 * Whether a viewer sees the «البرامج» links: a visitor only while the academy opens its catalog (API-205
 * `catalogPublic`), a learner always, staff never — and nobody while the session is still being restored: a staff
 * session would otherwise see the link appear and vanish a moment later (it only ever appears now, never withdraws).
 */
export function showsProgramsLink(viewer: PublicViewer, catalogPublic: boolean): boolean {
  if (viewer === 'learner') return true
  if (viewer === 'staff' || viewer === 'pending') return false
  return catalogPublic
}
