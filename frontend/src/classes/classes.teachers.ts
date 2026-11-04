// Teachers of a class (J-F01 on API-056), pure: the editor works on a draft
// list; the request is the whole final list, sent only when it differs from
// what the server holds (order does not matter — the server applies a diff).
// The local checks mirror backend/src/classes/class-teachers.changes.ts and
// the eligibility rules of the service (teacher role, invited or active) —
// the server stays the boundary.
import type { ClassTeacher, ClassTeacherRole, ReplaceClassTeachersInput } from '../api/classes'
import type { UserListItem } from '../api/users'

/** Upper bound of one replacement list (CLASS_TEACHERS_MAX). */
export const CLASS_TEACHERS_MAX = 20

/** The role a user must hold, and the account states that may be assigned. */
const TEACHER_ROLE_KEY = 'teacher'
const ELIGIBLE_STATUSES: readonly string[] = ['invited', 'active']

export interface TeacherDraft {
  userId: string
  fullName: string
  role: ClassTeacherRole
}

export function teacherDraftsOf(teachers: readonly ClassTeacher[]): TeacherDraft[] {
  return teachers.map(({ userId, fullName, role }) => ({ userId, fullName, role }))
}

/** Problems of a draft list on its own (mirror of `teachers_invalid`); null when it is valid. */
export function teacherListProblems(drafts: readonly TeacherDraft[]): { duplicates: string[]; leadCount: number } | null {
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const { userId } of drafts) {
    if (seen.has(userId) && !duplicates.includes(userId)) duplicates.push(userId)
    seen.add(userId)
  }
  const leadCount = drafts.filter((draft) => draft.role === 'lead').length
  return duplicates.length > 0 || leadCount > 1 ? { duplicates, leadCount } : null
}

/** The PUT body, or null when the draft holds the same users with the same roles as the server. */
export function planTeachersReplacement(current: readonly ClassTeacher[], drafts: readonly TeacherDraft[]): ReplaceClassTeachersInput | null {
  const stored = new Map(current.map((teacher) => [teacher.userId, teacher.role]))
  const same = drafts.length === stored.size && drafts.every((draft) => stored.get(draft.userId) === draft.role)
  return same ? null : { teachers: drafts.map(({ userId, role }) => ({ userId, role })) }
}

/** The role a newly added teacher gets: lead when the class has none yet. */
export function defaultRoleFor(drafts: readonly TeacherDraft[]): ClassTeacherRole {
  return drafts.some((draft) => draft.role === 'lead') ? 'assistant' : 'lead'
}

export type CandidateRefusal = 'already_listed' | 'not_a_teacher' | 'not_eligible'

/** Why a search result cannot be added (shown disabled, never sent); null when it can. */
export function candidateRefusal(candidate: Pick<UserListItem, 'id' | 'roles' | 'status' | 'deletedAt'>, drafts: readonly TeacherDraft[]): CandidateRefusal | null {
  if (drafts.some((draft) => draft.userId === candidate.id)) return 'already_listed'
  if (!candidate.roles.includes(TEACHER_ROLE_KEY)) return 'not_a_teacher'
  if (candidate.deletedAt !== null || !ELIGIBLE_STATUSES.includes(candidate.status)) return 'not_eligible'
  return null
}
