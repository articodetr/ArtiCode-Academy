// Course form ↔ API bodies (MOD-04-T05), on the pattern of
// academy/academy.patch.ts and users/users.patch.ts: the create body carries
// only what was filled in; the PATCH body carries only fields whose normalised
// value differs from the loaded course (null clears an optional field); a
// localized text travels as a whole object and keeps a Turkish text the form
// does not edit; nothing changed → null (no request).
import type { Course, CreateCourseInput, UpdateCourseInput } from '../api/courses'
import type { LocalizedLabel } from '../api/users'

/** Course codes: trimmed and upper-cased, 1–32 of A–Z 0–9 . _ - (mirror of COURSE_CODE_PATTERN). */
export const COURSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
export const COURSE_TEXT_MAX_LENGTH = 200
export const DURATION_HOURS_MAX = 99999.9
export const SESSIONS_MAX = 10000
export const AGE_MAX = 120

export interface CourseFormValues {
  code: string
  nameAr: string
  nameEn?: string
  summaryAr?: string
  summaryEn?: string
  descriptionAr?: string
  descriptionEn?: string
  levelId?: string | null
  durationHours?: number | null
  sessionsCount?: number | null
  minAge?: number | null
  maxAge?: number | null
}

export function normaliseCourseCode(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

const text = (value: string | null | undefined) => value ?? ''
const blankToNull = (value: number | null | undefined) => (value === undefined || value === null ? null : value)

/** Initial form values of a loaded course (null → empty). */
export function courseFormValuesOf(course: Course): CourseFormValues {
  return {
    code: course.code,
    nameAr: course.name.ar,
    nameEn: text(course.name.en),
    summaryAr: text(course.summary?.ar),
    summaryEn: text(course.summary?.en),
    descriptionAr: text(course.description?.ar),
    descriptionEn: text(course.description?.en),
    levelId: course.level?.id ?? null,
    durationHours: course.durationHours,
    sessionsCount: course.sessionsCount,
    minAge: course.minAge,
    maxAge: course.maxAge,
  }
}

/**
 * `{ ar, en? }` from two inputs; an empty Arabic text means "no text" (null) —
 * the form refuses English without Arabic. `keepTr` carries a stored Turkish
 * text the form does not show.
 */
export function localizedOf(ar: string | undefined, en: string | undefined, keepTr?: string): LocalizedLabel | null {
  const arabic = (ar ?? '').trim()
  if (!arabic) return null
  const label: LocalizedLabel = { ar: arabic }
  const english = (en ?? '').trim()
  if (english) label.en = english
  if (keepTr) label.tr = keepTr
  return label
}

/** Equal when every locale matches (an absent locale equals a missing one) — the server's `sameLocalizedText`. */
export function sameLabel(a: LocalizedLabel | null, b: LocalizedLabel | null): boolean {
  if (a === null || b === null) return a === b
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null)
}

/** True when both ages are set and the maximum is below the minimum. */
export function invalidAgeRange(minAge: number | null | undefined, maxAge: number | null | undefined): boolean {
  return minAge !== null && minAge !== undefined && maxAge !== null && maxAge !== undefined && maxAge < minAge
}

export function buildCreateCourseInput(values: CourseFormValues): CreateCourseInput {
  const input: CreateCourseInput = {
    code: normaliseCourseCode(values.code),
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
  }
  const summary = localizedOf(values.summaryAr, values.summaryEn)
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (summary) input.summary = summary
  if (description) input.description = description
  if (values.levelId) input.levelId = values.levelId
  if (values.durationHours !== undefined && values.durationHours !== null) input.durationHours = values.durationHours
  if (values.sessionsCount !== undefined && values.sessionsCount !== null) input.sessionsCount = values.sessionsCount
  if (values.minAge !== undefined && values.minAge !== null) input.minAge = values.minAge
  if (values.maxAge !== undefined && values.maxAge !== null) input.maxAge = values.maxAge
  return input
}

/** The smallest PATCH body (API-045), or null when nothing changed. */
export function planCoursePatch(course: Course, values: CourseFormValues): UpdateCourseInput | null {
  const body: UpdateCourseInput = {}
  const code = normaliseCourseCode(values.code)
  if (code && code !== course.code) body.code = code

  const name = localizedOf(values.nameAr, values.nameEn, course.name.tr)
  if (name && !sameLabel(name, course.name)) body.name = name
  const summary = localizedOf(values.summaryAr, values.summaryEn, course.summary?.tr)
  if (!sameLabel(summary, course.summary)) body.summary = summary
  const description = localizedOf(values.descriptionAr, values.descriptionEn, course.description?.tr)
  if (!sameLabel(description, course.description)) body.description = description

  const levelId = values.levelId || null
  if (levelId !== (course.level?.id ?? null)) body.levelId = levelId
  const numbers = ['durationHours', 'sessionsCount', 'minAge', 'maxAge'] as const
  for (const field of numbers) {
    const next = blankToNull(values[field])
    if (next !== course[field]) body[field] = next
  }
  return Object.keys(body).length > 0 ? body : null
}
