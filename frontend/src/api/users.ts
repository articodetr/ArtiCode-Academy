// MOD-03 user endpoints consumed by the users screen (MOD-03-T11):
// API-012 GET /api/users, API-013 GET /api/users/:id, API-014 POST /api/users,
// API-018 PATCH /api/users/:id. Types mirror backend/src/users/users.dto.ts.
import { apiRequest } from './client'

export const USER_STATUSES = ['invited', 'pending', 'active', 'suspended', 'archived'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

/** Kind of person created by POST /api/users: names the default role and the profile. */
export const USER_KINDS = ['student', 'teacher', 'staff', 'guardian'] as const
export type UserKind = (typeof USER_KINDS)[number]

export const USER_LOCALES = ['ar', 'en', 'tr'] as const
export type UserLocale = (typeof USER_LOCALES)[number]

export const EMPLOYEE_KINDS = ['teacher', 'staff'] as const
export type EmployeeKind = (typeof EMPLOYEE_KINDS)[number]

export const GUARDIAN_RELATIONSHIPS = ['father', 'mother', 'sibling', 'legal_guardian', 'other'] as const
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number]

export const USER_SORT_FIELDS = ['createdAt', 'fullName'] as const
export type UserSortField = (typeof USER_SORT_FIELDS)[number]
export type SortOrder = 'asc' | 'desc'

/**
 * Identity fields shared by list items and the detail (UserSummaryDto). For a
 * caller without `users.read_contact` the contact identifiers and the
 * security timestamps are null (reduced projection, D-R07 / ADR-030).
 */
export interface UserSummary {
  id: string
  email: string | null
  username: string | null
  phone: string | null
  fullName: string
  fullNameLatin: string | null
  displayName: string | null
  avatarUrl: string | null
  locale: string | null
  status: UserStatus
  emailVerifiedAt: string | null
  lastLoginAt: string | null
  lockedUntil: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface UserListItem extends UserSummary {
  /** Role keys, sorted. */
  roles: string[]
}

export interface UserList {
  items: UserListItem[]
  /** Pass as `cursor` with the same filters and sort to fetch the next page. */
  nextCursor: string | null
}

/** Localized text as the backend stores it: Arabic required, the rest optional. */
export interface LocalizedLabel {
  ar: string
  en?: string
  tr?: string
}

export interface UserRoleSummary {
  key: string
  label: LocalizedLabel
}

export interface StudentProfileSummary {
  studentNumber: string | null
  /** YYYY-MM-DD */
  dateOfBirth: string | null
  /** YYYY-MM-DD */
  enrolledOn: string | null
}

export interface EmployeeProfileSummary {
  employeeNumber: string | null
  kind: EmployeeKind
  jobTitle: string | null
  specialization: string | null
  /** YYYY-MM-DD */
  hiredOn: string | null
  isActive: boolean
}

/** One side of a guardian ↔ student link, seen from the other side. */
export interface GuardianLink {
  userId: string
  fullName: string
  displayName: string | null
  relationship: GuardianRelationship
  isPrimary: boolean
}

export interface UserDetail extends UserSummary {
  roles: UserRoleSummary[]
  studentProfile: StudentProfileSummary | null
  employeeProfile: EmployeeProfileSummary | null
  guardians: GuardianLink[]
  students: GuardianLink[]
}

export interface ListUsersParams {
  q?: string
  status?: UserStatus
  role?: string
  /** Needs `users.deactivate`; sent only when true. */
  includeDeleted?: boolean
  sort?: UserSortField
  order?: SortOrder
  /** 1–100, server default 20. */
  limit?: number
  cursor?: string
}

export const USERS_PATHS = {
  list: '/api/users',
  byId: (id: string) => `/api/users/${encodeURIComponent(id)}`,
} as const

/** Query string of API-012: empty and default-false values are left out. */
export function usersListPath(params: ListUsersParams = {}): string {
  const search = new URLSearchParams()
  const q = params.q?.trim()
  if (q) search.set('q', q)
  if (params.status) search.set('status', params.status)
  if (params.role) search.set('role', params.role)
  if (params.includeDeleted) search.set('includeDeleted', 'true')
  if (params.sort) search.set('sort', params.sort)
  if (params.order) search.set('order', params.order)
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  if (params.cursor) search.set('cursor', params.cursor)
  const query = search.toString()
  return query ? `${USERS_PATHS.list}?${query}` : USERS_PATHS.list
}

export function listUsers(params: ListUsersParams = {}, signal?: AbortSignal): Promise<UserList> {
  return apiRequest<UserList>(usersListPath(params), { signal })
}

export function getUser(id: string, options: { includeDeleted?: boolean; signal?: AbortSignal } = {}): Promise<UserDetail> {
  const path = options.includeDeleted ? `${USERS_PATHS.byId(id)}?includeDeleted=true` : USERS_PATHS.byId(id)
  return apiRequest<UserDetail>(path, { signal: options.signal })
}

export interface CreateStudentProfileInput {
  studentNumber?: string
  dateOfBirth?: string
  enrolledOn?: string
  notes?: string
}

export interface CreateEmployeeProfileInput {
  employeeNumber?: string
  jobTitle?: string
  specialization?: string
  hiredOn?: string
}

/** Body of API-014 (CreateUserDto): e-mail or username is required. */
export interface CreateUserInput {
  kind: UserKind
  email?: string
  username?: string
  phone?: string
  fullName: string
  fullNameLatin?: string
  displayName?: string
  locale?: UserLocale
  studentProfile?: CreateStudentProfileInput
  employeeProfile?: CreateEmployeeProfileInput
  /** Additional roles beyond the kind's default; needs `users.roles.assign`. */
  roleKeys?: string[]
}

export function createUser(input: CreateUserInput): Promise<UserDetail> {
  return apiRequest<UserDetail>(USERS_PATHS.list, { method: 'POST', body: input })
}

/** PATCH semantics (API-018): absent = unchanged, null = cleared, value = replaced. */
export interface UpdateStudentProfileInput {
  studentNumber?: string | null
  dateOfBirth?: string | null
  enrolledOn?: string | null
}

export interface UpdateEmployeeProfileInput {
  employeeNumber?: string | null
  jobTitle?: string | null
  specialization?: string | null
  hiredOn?: string | null
}

export interface UpdateUserInput {
  email?: string | null
  username?: string | null
  phone?: string | null
  /** Never nullable. */
  fullName?: string
  fullNameLatin?: string | null
  displayName?: string | null
  avatarUrl?: string | null
  locale?: UserLocale | null
  studentProfile?: UpdateStudentProfileInput
  employeeProfile?: UpdateEmployeeProfileInput
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UserDetail> {
  return apiRequest<UserDetail>(USERS_PATHS.byId(id), { method: 'PATCH', body: input })
}
