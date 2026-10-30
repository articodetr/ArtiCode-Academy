// Role management API (MOD-03-T13 on the T08 contracts API-022..API-026).
// Types mirror backend/src/roles/roles.dto.ts; every call goes through
// apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export type { LocalizedLabel } from './users'

/** `RoleDto` of API-022: a system or custom role with its active permission keys. */
export interface Role {
  id: string
  key: string
  label: LocalizedLabel
  description: LocalizedLabel | null
  /** Seeded role: never deleted; `academy_admin` never changed at all. */
  isSystem: boolean
  isDefaultForSignup: boolean
  /** Users holding the role (soft-deleted ones included). */
  userCount: number
  /** Active permission keys, sorted (deprecated grants are not listed). */
  permissions: string[]
  createdAt: string
  updatedAt: string
}

export interface RoleList {
  /** System roles first, then custom roles, each group by key. */
  items: Role[]
}

export interface Permission {
  key: string
  description: LocalizedLabel | null
}

export interface PermissionGroup {
  /** Owning module identifier, e.g. `MOD-03`. */
  module: string
  /** In catalog declaration order. */
  permissions: Permission[]
}

/** `PermissionCatalogDto` of API-023: the active catalog grouped by module. */
export interface PermissionCatalog {
  groups: PermissionGroup[]
  total: number
}

/** `LocalizedTextDto`: Arabic required, the other locales optional (blank ones are dropped before sending). */
export type LocalizedTextInput = LocalizedLabel

/** Body of API-024 (`CreateRoleDto`). */
export interface CreateRoleInput {
  key: string
  label: LocalizedTextInput
  description?: LocalizedTextInput
  permissions: string[]
}

/** Body of API-025 (`UpdateRoleDto`): absent = unchanged, `description: null` clears, `permissions` replaces the whole set. */
export interface UpdateRoleInput {
  label?: LocalizedTextInput
  description?: LocalizedTextInput | null
  permissions?: string[]
}

export const ROLES_PATHS = {
  list: '/api/roles',
  byId: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
  permissions: '/api/permissions',
} as const

export function listRoles(signal?: AbortSignal): Promise<RoleList> {
  return apiRequest<RoleList>(ROLES_PATHS.list, { signal })
}

export function listPermissions(signal?: AbortSignal): Promise<PermissionCatalog> {
  return apiRequest<PermissionCatalog>(ROLES_PATHS.permissions, { signal })
}

export function createRole(input: CreateRoleInput): Promise<Role> {
  return apiRequest<Role>(ROLES_PATHS.list, { method: 'POST', body: input })
}

export function updateRole(id: string, input: UpdateRoleInput): Promise<Role> {
  return apiRequest<Role>(ROLES_PATHS.byId(id), { method: 'PATCH', body: input })
}

/** API-026 answers 204; the promise resolves with nothing. */
export async function deleteRole(id: string): Promise<void> {
  await apiRequest<undefined>(ROLES_PATHS.byId(id), { method: 'DELETE' })
}
