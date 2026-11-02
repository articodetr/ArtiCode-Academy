// Course levels (MOD-04-T02): API-037..API-041. Types mirror
// backend/src/levels/levels.dto.ts. The courses screen reads them for its
// level filter and picker (T05); the levels tab manages them (T06) — writes
// need `courses.manage`, the server decides.
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

export interface Level {
  id: string
  code: string
  name: LocalizedLabel
  description: LocalizedLabel | null
  sortOrder: number
  isActive: boolean
  /** Courses using the level — for holders of `courses.manage` only (null otherwise). */
  courseCount: number | null
  createdAt: string
  updatedAt: string
}

export interface LevelList {
  items: Level[]
}

/** Body of API-038 (`CreateLevelDto`): appended at the end of the order. */
export interface CreateLevelInput {
  code: string
  name: LocalizedLabel
  description?: LocalizedLabel
  isActive?: boolean
}

/** Body of API-039 (`UpdateLevelDto`): absent = unchanged, null clears the description. */
export interface UpdateLevelInput {
  code?: string
  name?: LocalizedLabel
  description?: LocalizedLabel | null
  isActive?: boolean
}

export const LEVELS_PATH = '/api/levels'

const levelPath = (id: string) => `${LEVELS_PATH}/${encodeURIComponent(id)}`

/** Active levels for `courses.read`; every level with its course count for `courses.manage`. */
export function listLevels(signal?: AbortSignal): Promise<LevelList> {
  return apiRequest<LevelList>(LEVELS_PATH, { signal })
}

export function createLevel(input: CreateLevelInput): Promise<Level> {
  return apiRequest<Level>(LEVELS_PATH, { method: 'POST', body: input })
}

export function updateLevel(id: string, input: UpdateLevelInput): Promise<Level> {
  return apiRequest<Level>(levelPath(id), { method: 'PATCH', body: input })
}

/** API-040: refused with `409 level_in_use { courseCount }` while a course uses the level; resolves on 204. */
export function deleteLevel(id: string): Promise<void> {
  return apiRequest<void>(levelPath(id), { method: 'DELETE' })
}

/** API-041: the complete new order (every level exactly once); answers with the reordered list. */
export function reorderLevels(levelIds: string[]): Promise<LevelList> {
  return apiRequest<LevelList>(`${LEVELS_PATH}/order`, { method: 'PUT', body: { levelIds } })
}
