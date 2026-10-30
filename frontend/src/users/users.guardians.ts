// Rules of the guardians/students tab (MOD-03-T14) as pure functions on the
// T09 contracts (API-029..API-033, ADR-036). The server stays the authority;
// these refuse locally what it would refuse and build the request bodies.
//
//   a student gets a "guardians" tab, a guardian a "students" tab (both when both)
//   every write addresses the student's path: /api/users/:studentId/guardians[/:guardianId]
//   nobody is linked to themself (AC3 — refused before any request)
//   an existing link is not repeated (409 already_linked otherwise)
//   PATCH carries only what changes; nothing to change = no request
import type { GuardianLinkItem, LinkGuardianInput, UpdateGuardianLinkInput } from '../api/guardians'
import type { GuardianRelationship, UserDetail } from '../api/users'

export type LinkSide = 'guardians' | 'students'

/**
 * Which link tabs a user gets: `guardians` for a student (by role, or by
 * existing links when the role was removed), `students` for a guardian.
 */
export function linkSidesOf(user: Pick<UserDetail, 'roles' | 'guardians' | 'students'>): LinkSide[] {
  const keys = new Set(user.roles.map((role) => role.key))
  const sides: LinkSide[] = []
  if (keys.has('student') || user.guardians.length > 0) sides.push('guardians')
  if (keys.has('guardian') || user.students.length > 0) sides.push('students')
  return sides
}

/** The role the other party must hold (`422 not_a_guardian|not_a_student`); also the `role` filter of the search (API-012). */
export function counterpartRole(side: LinkSide): 'guardian' | 'student' {
  return side === 'guardians' ? 'guardian' : 'student'
}

/** Path parties of API-031..API-033 for a link between `userId` (the tab's user) and `otherId`, seen from `side`. */
export function partiesOf(side: LinkSide, userId: string, otherId: string): { studentId: string; guardianId: string } {
  return side === 'guardians' ? { studentId: userId, guardianId: otherId } : { studentId: otherId, guardianId: userId }
}

export type LinkRefusal = 'same_person' | 'already_linked'

/** Local checks before POST: nobody is linked to themself (AC3); a linked party is not linked again. */
export function linkRefusal(userId: string, otherId: string | undefined, linkedIds: Iterable<string>): LinkRefusal | null {
  if (!otherId) return null
  if (otherId === userId) return 'same_person'
  for (const id of linkedIds) if (id === otherId) return 'already_linked'
  return null
}

export interface LinkFormValues {
  /** The other party chosen in the search. */
  otherId?: string
  relationship?: GuardianRelationship
  isPrimary?: boolean
}

/** Body of API-031 (`isPrimary` only when true — the server default is false). */
export function buildLinkInput(side: LinkSide, userId: string, values: LinkFormValues): LinkGuardianInput {
  const otherId = values.otherId ?? ''
  const input: LinkGuardianInput = {
    guardianId: partiesOf(side, userId, otherId).guardianId,
    relationship: values.relationship ?? 'other',
  }
  if (values.isPrimary) input.isPrimary = true
  return input
}

/** PATCH body moving `current` to `requested`, or null when nothing differs. */
export function planLinkUpdate(current: Pick<GuardianLinkItem, 'relationship' | 'isPrimary'>, requested: UpdateGuardianLinkInput): UpdateGuardianLinkInput | null {
  const body: UpdateGuardianLinkInput = {}
  if (requested.relationship !== undefined && requested.relationship !== current.relationship) body.relationship = requested.relationship
  if (requested.isPrimary !== undefined && requested.isPrimary !== current.isPrimary) body.isPrimary = requested.isPrimary
  return Object.keys(body).length === 0 ? null : body
}
