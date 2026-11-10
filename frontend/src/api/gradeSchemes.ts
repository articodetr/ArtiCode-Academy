// Grade schemes (MOD-09-T02 — owner decision D-R46): API-122 GET
// /api/grade-schemes (every signed-in user sees the active schemes; holders of
// `academy.settings.manage` also see inactive ones and the final-grade count of
// each), API-123 POST, API-124 PATCH /:id and API-125 DELETE /:id
// (`academy.settings.manage`). Types mirror backend/src/grades/grade-schemes.dto.ts
// field by field; every call goes through apiRequest (Bearer header,
// refresh-and-retry on 401). The band rules the server checks live in
// grades/gradeSchemes.changes.ts (a mirror of grade-schemes.changes.ts).
import { apiRequest } from './client'
import type { LocalizedLabel } from './users'

/** `GRADE_SCHEME_BANDS_MIN`/`_MAX` of grade-schemes.dto.ts: a scheme holds 2..20 bands. */
export const GRADE_SCHEME_BANDS_MIN = 2
export const GRADE_SCHEME_BANDS_MAX = 20
/** `BAND_LETTER_MAX_LENGTH`: an optional short code (A, B+, …) of 1..4 characters after trimming. */
export const BAND_LETTER_MAX_LENGTH = 4
/** `LOCALIZED_TEXT_MAX_LENGTH` of LocalizedTextDto (the scheme name and every band label). */
export const GRADE_SCHEME_TEXT_MAX_LENGTH = 200

/** `GradeSchemeBandDto`: the band covers the percentages from `minPercent` up to the next band's. */
export interface GradeSchemeBand {
  /** 0..100 with at most two decimals (numeric(5,2) as a JSON number), unique inside the scheme. */
  minPercent: number
  label: LocalizedLabel
  letter: string | null
  isPass: boolean
}

/** `GradeSchemeDto`. */
export interface GradeScheme {
  id: string
  name: LocalizedLabel
  /** Exactly one scheme is the default once a scheme exists, and the default is always active. */
  isDefault: boolean
  isActive: boolean
  /** Ascending by minimum. */
  bands: GradeSchemeBand[]
  /** Final grades fixed with this scheme (a used scheme is deactivated, never deleted); null without `academy.settings.manage`. */
  finalGradeCount: number | null
  createdAt: string
  updatedAt: string
}

/** `GradeSchemeListDto`: the default first, then by creation; no pagination. */
export interface GradeSchemeList {
  items: GradeScheme[]
}

/** `GradeSchemeBandInputDto`: `minPercent` and `isPass` are raw JSON values; a blank or absent `letter` = none. */
export interface GradeSchemeBandInput {
  minPercent: number
  label: LocalizedLabel
  letter?: string | null
  isPass: boolean
}

/**
 * Body of API-123 (`CreateGradeSchemeDto`): the whole band list in any order
 * (stored ascending). `isDefault: true` makes the new scheme the default (the
 * previous default steps down); the first scheme of the academy becomes the
 * default whatever the body says. A new scheme is always active.
 */
export interface CreateGradeSchemeInput {
  name: LocalizedLabel
  bands: GradeSchemeBandInput[]
  isDefault?: boolean
}

/**
 * Body of API-124 (`UpdateGradeSchemeDto`): absent = unchanged; `name` replaces
 * the whole localized object and `bands` the whole list; `isDefault: true`
 * promotes (false on the default is refused — `grade_scheme_is_default`
 * `unset_default`), `isActive: false` deactivates (refused for the default).
 */
export interface UpdateGradeSchemeInput {
  name?: LocalizedLabel
  bands?: GradeSchemeBandInput[]
  isDefault?: boolean
  isActive?: boolean
}

export const GRADE_SCHEMES_PATH = '/api/grade-schemes'

const gradeSchemePath = (id: string) => `${GRADE_SCHEMES_PATH}/${encodeURIComponent(id)}`

export function listGradeSchemes(signal?: AbortSignal): Promise<GradeSchemeList> {
  return apiRequest<GradeSchemeList>(GRADE_SCHEMES_PATH, { signal })
}

export function createGradeScheme(input: CreateGradeSchemeInput): Promise<GradeScheme> {
  return apiRequest<GradeScheme>(GRADE_SCHEMES_PATH, { method: 'POST', body: input })
}

export function updateGradeScheme(id: string, input: UpdateGradeSchemeInput): Promise<GradeScheme> {
  return apiRequest<GradeScheme>(gradeSchemePath(id), { method: 'PATCH', body: input })
}

/** API-125: refused for the default (`409 grade_scheme_is_default` `delete`) and for a scheme final grades use (`409 grade_scheme_in_use`); resolves on 204. */
export function deleteGradeScheme(id: string): Promise<void> {
  return apiRequest<void>(gradeSchemePath(id), { method: 'DELETE' })
}
