// Course levels (MOD-04-T02): API-037 GET /api/levels. Types mirror
// backend/src/levels/levels.dto.ts. The courses screen (T05) only reads them
// for its level filter and picker; the management calls arrive with T06.
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

export const LEVELS_PATH = '/api/levels'

/** Active levels for `courses.read`; every level with its course count for `courses.manage`. */
export function listLevels(signal?: AbortSignal): Promise<LevelList> {
  return apiRequest<LevelList>(LEVELS_PATH, { signal })
}
