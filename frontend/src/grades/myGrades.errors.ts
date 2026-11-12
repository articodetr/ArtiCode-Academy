// Maps a failed read of «my grades» (API-129) to a translation key under
// `myGrades.errors` (or the shared `login.errors.*`). The one refusal of its
// own is `403 permission_denied { missing: ["grades.read_own",
// "grades.read_linked"] }` — a caller holding neither key (`myGradesMissing()`
// of backend/src/grades/my-grades.policy.ts): `forbidden` tells the page to
// word it in place of the grades, since no retry can change it. Unit-tested
// in myGrades.errors.test.ts.
import { ApiError } from '../api/client'
import { failureMessage as usersFailureMessage } from '../users/users.errors'
import type { UsersFailure } from '../users/users.errors'

export interface MyGradesFailure extends UsersFailure {
  /** The caller's roles hold neither grades key: the page shows the reason instead of the grades. */
  forbidden: boolean
}

export const failureMessage = usersFailureMessage

export function describeMyGradesFailure(error: unknown): MyGradesFailure {
  if (!(error instanceof ApiError)) return { key: 'login.errors.network', forbidden: false }
  if (error.code === 'permission_denied') return { key: 'myGrades.errors.permission_denied', forbidden: true }
  if (error.code === 'rate_limited') return { key: 'myGrades.errors.rate_limited', forbidden: false }
  // A 400 without a code is the DTO's validation (a malformed classId or studentId).
  if (error.status === 400) return { key: 'myGrades.errors.validation', params: { message: error.message }, forbidden: false }
  if (error.status >= 500) return { key: 'login.errors.server', forbidden: false }
  return { key: 'login.errors.generic', forbidden: false }
}
