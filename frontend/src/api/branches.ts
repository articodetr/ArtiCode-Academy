// Academy branches (MOD-02-T06 — O8): API-080 GET /api/branches (every
// signed-in user sees the active branches; holders of `branches.manage` also
// see inactive ones), API-081 POST, API-082 PATCH /:id and API-083 DELETE /:id
// (`branches.manage`). Types mirror backend/src/branches/branches.dto.ts; every
// call goes through apiRequest (Bearer header, refresh-and-retry on 401).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** `BranchDto`. */
export interface Branch {
  id: string
  /** Upper-case, unique among branches. */
  code: string
  name: LocalizedLabel
  address: LocalizedLabel | null
  /** E.164, or null. */
  phone: string | null
  /** IANA time zone (or `UTC`); null = the academy's. */
  timezone: string | null
  /** At most one branch is main, and the main branch is always active. */
  isMain: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** `BranchListDto`: the main branch first, then by code; no pagination. */
export interface BranchList {
  items: Branch[]
}

/**
 * Body of API-081 (`CreateBranchDto`): `isMain` defaults to false and
 * `isActive` to true on the server, so a form sends them only when they differ.
 */
export interface CreateBranchInput {
  code: string
  name: LocalizedLabel
  address?: LocalizedLabel
  phone?: string
  timezone?: string
  isMain?: boolean
  isActive?: boolean
}

/**
 * Body of API-082 (`UpdateBranchDto`): absent = unchanged; `null` clears
 * `address`, `phone` and `timezone`; `name` replaces the whole localized
 * object; `code`, `name`, `isMain` and `isActive` are never null.
 */
export interface UpdateBranchInput {
  code?: string
  name?: LocalizedLabel
  address?: LocalizedLabel | null
  phone?: string | null
  timezone?: string | null
  isMain?: boolean
  isActive?: boolean
}

export const BRANCHES_PATH = '/api/branches'

const branchPath = (id: string) => `${BRANCHES_PATH}/${encodeURIComponent(id)}`

export function listBranches(signal?: AbortSignal): Promise<BranchList> {
  return apiRequest<BranchList>(BRANCHES_PATH, { signal })
}

export function createBranch(input: CreateBranchInput): Promise<Branch> {
  return apiRequest<Branch>(BRANCHES_PATH, { method: 'POST', body: input })
}

export function updateBranch(id: string, input: UpdateBranchInput): Promise<Branch> {
  return apiRequest<Branch>(branchPath(id), { method: 'PATCH', body: input })
}

/** API-083: refused for the main branch (`409 branch_is_main`) and for a branch with rooms (`409 branch_in_use`); resolves on 204. */
export function deleteBranch(id: string): Promise<void> {
  return apiRequest<void>(branchPath(id), { method: 'DELETE' })
}
