// Course form ↔ API bodies (MOD-04-T05), on the pattern of
// academy/academy.patch.ts and users/users.patch.ts: the create body carries
// only what was filled in; the PATCH body carries only fields whose normalised
// value differs from the loaded course (null clears an optional field); a
// localized text travels as a whole object and keeps a Turkish text the form
// does not edit; nothing changed → null (no request).
// PORTAL-04: the form edits the school subject (`subjectId`, null clears it) and no
// longer the age range — neither body carries `minAge`/`maxAge`, so a PATCH leaves
// the stored ages alone; the sessions stay.
import type { Course, CoursePricing, CourseResource, CreateCourseInput, UpdateCourseInput } from '../api/courses'
import type { FeePlan } from '../api/feePlans'
import type { LocalizedLabel } from '../api/users'

/** Course codes: trimmed and upper-cased, 1–32 of A–Z 0–9 . _ - (mirror of COURSE_CODE_PATTERN). */
export const COURSE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
export const COURSE_TEXT_MAX_LENGTH = 200
export const DURATION_HOURS_MAX = 99999.9
export const SESSIONS_MAX = 10000
/** MOD-19 (D-R129): COVER_IMAGE_URL_MAX of courses.dto.ts and ck_courses_cover_image_url. */
export const COVER_IMAGE_URL_MAX = 2048

export interface CourseFormValues {
  code: string
  nameAr: string
  nameEn?: string
  summaryAr?: string
  summaryEn?: string
  descriptionAr?: string
  descriptionEn?: string
  levelId?: string | null
  /** PORTAL-04: the school subject; null/absent = none. */
  subjectId?: string | null
  durationHours?: number | null
  sessionsCount?: number | null
  /** MOD-19: an absolute http(s) URL; '' = no cover. */
  coverImageUrl?: string
  /** MOD-19 (D-R122): shown only to holders of `fee_plans.manage`; absent = the form does not edit the price. */
  pricing?: CoursePricing
  /** The plan of a paid course. */
  enrollmentFeePlanId?: string | null
  /** J-F67: the course's materials, in the edit form only (absent = the form does not edit them). */
  resources?: CourseResourceRow[]
}

/** One row of «مقرّر الدورة» in the edit form: the Arabic title and the address. */
export interface CourseResourceRow {
  titleAr?: string
  url?: string
}

/** The mirror of the server's rule for a resource address (learning.content.ts): an absolute https URL without spaces. */
export function isResourceUrl(value: string | undefined): boolean {
  const text = (value ?? '').trim()
  return text.length > 0 && text.length <= 2048 && /^https:\/\/[^\s]+$/.test(text)
}

/**
 * The materials the form would save: every row with something typed, in order. A row whose title and address are
 * those of the stored item at the same place keeps that item whole (its English or Turkish title too).
 */
export function resourcesOfRows(rows: readonly CourseResourceRow[], current: readonly CourseResource[]): CourseResource[] {
  return rows
    .filter((row) => (row.titleAr ?? '').trim() !== '' || (row.url ?? '').trim() !== '')
    .map((row, index) => {
      const titleAr = (row.titleAr ?? '').trim()
      const url = (row.url ?? '').trim()
      const stored = current[index]
      return stored && stored.title.ar === titleAr && stored.url === url ? stored : { title: { ar: titleAr }, url }
    })
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
    subjectId: course.subject?.id ?? null,
    durationHours: course.durationHours,
    sessionsCount: course.sessionsCount,
    coverImageUrl: course.coverImageUrl ?? '',
    pricing: course.pricing,
    enrollmentFeePlanId: course.enrollmentFeePlan?.id ?? null,
    resources: (course.resources ?? []).map((resource) => ({ titleAr: resource.title.ar, url: resource.url })),
  }
}

/**
 * Mirror of the cover rule (ck_courses_cover_image_url + `IsUrl` of
 * courses.dto.ts): an absolute http(s) URL without white space, at most 2,048
 * characters. Blank is valid (no cover).
 */
export function isCoverImageUrl(value: string | undefined): boolean {
  const text = (value ?? '').trim()
  if (!text) return true
  if (text.length > COVER_IMAGE_URL_MAX || !/^https?:\/\/\S+$/i.test(text)) return false
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

const coverOf = (value: string | undefined) => (value ?? '').trim() || null

/**
 * Mirror of `coursePlanFits()` (backend/src/catalog/course-pricing.ts): the
 * ACTIVE plans that can price a request for this course — a plan of this
 * course, or a general plan (no course and no class). The server decides.
 */
export function plansFittingCourse(plans: readonly FeePlan[], courseId: string): FeePlan[] {
  return plans.filter((plan) => plan.isActive && plan.class === null && (plan.course === null || plan.course.id === courseId))
}

/** The plan the form asks for: none for a free course, the chosen one for a paid course (null while none is chosen). */
function chosenPlanOf(values: CourseFormValues): string | null {
  return values.pricing === 'paid' ? values.enrollmentFeePlanId || null : null
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
  if (values.subjectId) input.subjectId = values.subjectId
  if (values.durationHours !== undefined && values.durationHours !== null) input.durationHours = values.durationHours
  if (values.sessionsCount !== undefined && values.sessionsCount !== null) input.sessionsCount = values.sessionsCount
  const cover = coverOf(values.coverImageUrl)
  if (cover) input.coverImageUrl = cover
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
  // An emptied picker (antd answers undefined on clear) clears the subject, as the level.
  const subjectId = values.subjectId || null
  if (subjectId !== (course.subject?.id ?? null)) body.subjectId = subjectId
  // The age range is no longer edited here (PORTAL-04): the stored values stay untouched.
  const numbers = ['durationHours', 'sessionsCount'] as const
  for (const field of numbers) {
    const next = blankToNull(values[field])
    if (next !== course[field]) body[field] = next
  }
  // MOD-19: the cover (null clears it) and — only when the form edits the price — the plan (null = free again).
  if (values.coverImageUrl !== undefined) {
    const cover = coverOf(values.coverImageUrl)
    if (cover !== course.coverImageUrl) body.coverImageUrl = cover
  }
  // J-F67: the course's materials, sent whole and only when they differ.
  if (values.resources !== undefined) {
    const current = course.resources ?? []
    const next = resourcesOfRows(values.resources, current)
    if (JSON.stringify(next) !== JSON.stringify(current)) body.resources = next
  }
  if (values.pricing !== undefined) {
    const plan = chosenPlanOf(values)
    const current = course.enrollmentFeePlan?.id ?? null
    // A paid course without a chosen plan is refused by the form, never sent as "free".
    if (!(values.pricing === 'paid' && plan === null) && plan !== current) body.enrollmentFeePlanId = plan
  }
  return Object.keys(body).length > 0 ? body : null
}

/**
 * An English text typed without its Arabic text: localizedOf() drops it (the
 * server requires `ar`) and the form refuses it on save, yet it is typed work.
 */
export function englishWithoutArabic(ar: string | undefined, en: string | undefined): boolean {
  return (en ?? '').trim() !== '' && (ar ?? '').trim() === ''
}

/**
 * Whether the edit form of the course drawer holds unsaved work (KI-054 — J-F23,
 * the rule of J-F21's classFormHasChanges()): the smallest PATCH is non-empty,
 * or the form holds what the save would refuse instead of sending — an emptied
 * code or Arabic name, an English summary or description without its Arabic
 * text. A field changed back to its stored value counts as no change.
 */
export function courseFormHasChanges(course: Course, values: CourseFormValues): boolean {
  const blank = (value: string | undefined) => typeof value === 'string' && value.trim() === ''
  return (
    blank(values.code) ||
    blank(values.nameAr) ||
    englishWithoutArabic(values.summaryAr, values.summaryEn) ||
    englishWithoutArabic(values.descriptionAr, values.descriptionEn) ||
    // MOD-19: a course switched to paid without a plan yet, or a cover the save would refuse, is typed work too.
    (values.pricing !== undefined && values.pricing !== course.pricing) ||
    !isCoverImageUrl(values.coverImageUrl) ||
    planCoursePatch(course, values) !== null
  )
}
