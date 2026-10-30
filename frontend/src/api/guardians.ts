// Guardian ↔ student links (MOD-03-T14 on the T09 contracts API-029..API-033).
// Types mirror backend/src/guardians/guardians.dto.ts: `user` of every item is
// the other party in the caller's projection (contact fields need
// `users.read_contact`, D-R07). Every call goes through apiRequest (Bearer
// header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { GuardianRelationship, UserListItem } from './users'

/** `GuardianLinkItemDto`: one link seen from either side. */
export interface GuardianLinkItem {
  /** The guardian under `/guardians`, the student under `/students`. */
  user: UserListItem
  relationship: GuardianRelationship
  /** Whether this guardian is the student's primary guardian (at most one per student). */
  isPrimary: boolean
  /** ISO 8601 — when the link was created. */
  createdAt: string
}

export interface GuardianLinkList {
  /** Guardians: primary first, then by link creation; students: by link creation. Links to soft-deleted users are hidden. */
  items: GuardianLinkItem[]
}

/** Body of API-031 (`LinkGuardianDto`): the guardian must differ from the student in the path. */
export interface LinkGuardianInput {
  guardianId: string
  relationship: GuardianRelationship
  /** Makes this guardian the student's primary guardian (demoting the current one); default false. */
  isPrimary?: boolean
}

/** Body of API-032 (`UpdateGuardianLinkDto`): absent = unchanged; `{}` is refused (`nothing_to_update`). */
export interface UpdateGuardianLinkInput {
  relationship?: GuardianRelationship
  /** `true` makes this guardian primary; `false` leaves the student without a primary guardian. */
  isPrimary?: boolean
}

export const GUARDIANS_PATHS = {
  guardians: (studentId: string) => `/api/users/${encodeURIComponent(studentId)}/guardians`,
  students: (guardianId: string) => `/api/users/${encodeURIComponent(guardianId)}/students`,
  link: (studentId: string, guardianId: string) =>
    `/api/users/${encodeURIComponent(studentId)}/guardians/${encodeURIComponent(guardianId)}`,
} as const

/** API-029: the guardians of a student (`users.read`). */
export function listGuardians(studentId: string, signal?: AbortSignal): Promise<GuardianLinkList> {
  return apiRequest<GuardianLinkList>(GUARDIANS_PATHS.guardians(studentId), { signal })
}

/** API-030: the students of a guardian (`users.read`). */
export function listStudents(guardianId: string, signal?: AbortSignal): Promise<GuardianLinkList> {
  return apiRequest<GuardianLinkList>(GUARDIANS_PATHS.students(guardianId), { signal })
}

/** API-031 (`guardians.link`): answers 201 with the new link, the guardian in the caller's projection. */
export function linkGuardian(studentId: string, input: LinkGuardianInput): Promise<GuardianLinkItem> {
  return apiRequest<GuardianLinkItem>(GUARDIANS_PATHS.guardians(studentId), { method: 'POST', body: input })
}

/** API-032 (`guardians.link`): answers 200 with the link after the change. */
export function updateGuardianLink(studentId: string, guardianId: string, input: UpdateGuardianLinkInput): Promise<GuardianLinkItem> {
  return apiRequest<GuardianLinkItem>(GUARDIANS_PATHS.link(studentId, guardianId), { method: 'PATCH', body: input })
}

/** API-033 (`guardians.link`): answers 204; the promise resolves with nothing. */
export async function unlinkGuardian(studentId: string, guardianId: string): Promise<void> {
  await apiRequest<undefined>(GUARDIANS_PATHS.link(studentId, guardianId), { method: 'DELETE' })
}
