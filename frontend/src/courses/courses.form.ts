// Course form ↔ API bodies (MOD-04-T05), on the pattern of
// academy/academy.patch.ts and users/users.patch.ts: the create body carries
// only what was filled in; the PATCH body carries only fields whose normalised
// value differs from the loaded course (null clears an optional field);
// nothing changed → null (no request).
// PORTAL-04: the form edits the school subject (`subjectId`, null clears it) and no
// longer the age range — neither body carries `minAge`/`maxAge`, so a PATCH leaves
// the stored ages alone.
// The simplified course form: the form asks the Arabic name, summary and description, the cover,
// the subject and the price only. Neither body names the code (the server generates one when the
// create body has none), the level, the hours or the sessions, so a PATCH keeps the stored values;
// a localized text keeps its stored English and Turkish texts when its Arabic text changes.
import type { Course, CoursePricing, CourseResource, CreateCourseInput, UpdateCourseInput } from '../api/courses'
import type { FeePlan } from '../api/feePlans'
import type { LocalizedLabel } from '../api/users'

export const COURSE_TEXT_MAX_LENGTH = 200
/** MOD-19 (D-R129): COVER_IMAGE_URL_MAX of courses.dto.ts and ck_courses_cover_image_url. */
export const COVER_IMAGE_URL_MAX = 2048

export interface CourseFormValues {
  nameAr: string
  summaryAr?: string
  descriptionAr?: string
  /** PORTAL-04: the school subject; null/absent = none. */
  subjectId?: string | null
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

/** Codes of levels, subjects and rooms: trimmed and upper-cased (the course form itself asks no code any more). */
export function normaliseCourseCode(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

const text = (value: string | null | undefined) => value ?? ''

/** Initial form values of a loaded course (null → empty): the fields the form shows, nothing else. */
export function courseFormValuesOf(course: Course): CourseFormValues {
  return {
    nameAr: course.name.ar,
    summaryAr: text(course.summary?.ar),
    descriptionAr: text(course.description?.ar),
    subjectId: course.subject?.id ?? null,
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
 * course, or a general plan (no course and no class). Without a course (the
 * create modal: it does not exist yet) only the general plans fit. The server decides.
 */
export function plansFittingCourse(plans: readonly FeePlan[], courseId: string | null): FeePlan[] {
  return plans.filter((plan) => plan.isActive && plan.class === null && (plan.course === null || (courseId !== null && plan.course.id === courseId)))
}

/** The plan the form asks for: none for a free course, the chosen one for a paid course (null while none is chosen). */
function chosenPlanOf(values: CourseFormValues): string | null {
  return values.pricing === 'paid' ? values.enrollmentFeePlanId || null : null
}

/**
 * `{ ar, en? }` from two inputs; an empty Arabic text means "no text" (null) —
 * the form refuses English without Arabic. `keepTr` carries a stored Turkish
 * text the form does not show. (Shared by the other modules' forms.)
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

/**
 * A course text from its Arabic input alone, keeping the stored English and
 * Turkish texts the form no longer shows. An empty Arabic text means "no text"
 * (null): the server requires `ar`, so emptying it clears the whole text.
 */
export function arabicTextOf(ar: string | undefined, stored?: LocalizedLabel | null): LocalizedLabel | null {
  const arabic = (ar ?? '').trim()
  if (!arabic) return null
  const label: LocalizedLabel = { ar: arabic }
  if (typeof stored?.en === 'string') label.en = stored.en
  if (typeof stored?.tr === 'string') label.tr = stored.tr
  return label
}

/** The fields of the course forms. */
const COURSE_FORM_FIELDS: ReadonlySet<string> = new Set(['nameAr', 'summaryAr', 'descriptionAr', 'coverImageUrl', 'subjectId', 'pricing', 'enrollmentFeePlanId', 'resources'])

/**
 * The form field a server error belongs on, or undefined when the form has no
 * such field any more (a taken code, an unknown level): that error then shows
 * above the form instead of on a field nobody sees.
 */
export function courseFormField(field: readonly string[] | undefined): string[] | undefined {
  return field !== undefined && field.length > 0 && COURSE_FORM_FIELDS.has(field[0]!) ? [...field] : undefined
}

/** Equal when every locale matches (an absent locale equals a missing one) — the server's `sameLocalizedText`. */
export function sameLabel(a: LocalizedLabel | null, b: LocalizedLabel | null): boolean {
  if (a === null || b === null) return a === b
  return a.ar === b.ar && (a.en ?? null) === (b.en ?? null) && (a.tr ?? null) === (b.tr ?? null)
}

/** The body of API-044: no code (the server generates it), Arabic texts only, the plan of a paid course. */
export function buildCreateCourseInput(values: CourseFormValues): CreateCourseInput {
  const input: CreateCourseInput = { name: { ar: (values.nameAr ?? '').trim() } }
  const summary = arabicTextOf(values.summaryAr)
  const description = arabicTextOf(values.descriptionAr)
  if (summary) input.summary = summary
  if (description) input.description = description
  const cover = coverOf(values.coverImageUrl)
  if (cover) input.coverImageUrl = cover
  if (values.subjectId) input.subjectId = values.subjectId
  // A paid course without a chosen plan is refused by the form; free sends no plan at all.
  const plan = chosenPlanOf(values)
  if (plan) input.enrollmentFeePlanId = plan
  return input
}

/** The smallest PATCH body (API-045), or null when nothing changed. Never names a field the form does not show. */
export function planCoursePatch(course: Course, values: CourseFormValues): UpdateCourseInput | null {
  const body: UpdateCourseInput = {}

  const name = arabicTextOf(values.nameAr, course.name)
  if (name && !sameLabel(name, course.name)) body.name = name
  const summary = arabicTextOf(values.summaryAr, course.summary)
  if (!sameLabel(summary, course.summary)) body.summary = summary
  const description = arabicTextOf(values.descriptionAr, course.description)
  if (!sameLabel(description, course.description)) body.description = description

  // An emptied picker (antd answers undefined on clear) clears the subject.
  const subjectId = values.subjectId || null
  if (subjectId !== (course.subject?.id ?? null)) body.subjectId = subjectId
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
 * (Shared by the other modules' forms; the course form has no English field.)
 */
export function englishWithoutArabic(ar: string | undefined, en: string | undefined): boolean {
  return (en ?? '').trim() !== '' && (ar ?? '').trim() === ''
}

/**
 * Whether the edit form of the course drawer holds unsaved work (KI-054 — J-F23,
 * the rule of J-F21's classFormHasChanges()): the smallest PATCH is non-empty,
 * or the form holds what the save would refuse instead of sending — an emptied
 * name, a paid course without its plan, a cover the save refuses. A field
 * changed back to its stored value counts as no change.
 */
export function courseFormHasChanges(course: Course, values: CourseFormValues): boolean {
  const blank = (value: string | undefined) => typeof value === 'string' && value.trim() === ''
  return (
    blank(values.nameAr) ||
    // MOD-19: a course switched to paid without a plan yet, or a cover the save would refuse, is typed work too.
    (values.pricing !== undefined && values.pricing !== course.pricing) ||
    !isCoverImageUrl(values.coverImageUrl) ||
    planCoursePatch(course, values) !== null
  )
}
