// Class form ↔ API bodies (J-F01), on the pattern of courses/courses.form.ts:
// the create body carries only what was filled in; the PATCH body carries only
// fields whose normalised value differs from the loaded class (null clears the
// dates and the notes); the name travels as a whole object and keeps a Turkish
// text the form does not edit; nothing changed → null (no request). Local rules
// mirror backend/src/classes/classes.dto.ts — the server decides.
import type { AcademyClass, CreateClassInput, UpdateClassInput } from '../api/classes'
import { localizedOf, sameLabel } from '../courses/courses.form'

/** Class codes: trimmed and upper-cased, 1–32 of A–Z 0–9 . _ - (mirror of CLASS_CODE_PATTERN). */
export const CLASS_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
export const CLASS_NAME_MAX_LENGTH = 200
/** `capacity` is a smallint (> 0 by CHECK). */
export const CLASS_CAPACITY_MAX = 32767
export const CLASS_NOTES_MAX_LENGTH = 2000
export const CLASS_STATUS_REASON_MAX_LENGTH = 500

export interface ClassFormValues {
  /** Creation only: the course is fixed afterwards. */
  courseId?: string
  code: string
  nameAr: string
  nameEn?: string
  capacity?: number | null
  /** `YYYY-MM-DD` from a native date input; '' = no date. */
  startsOn?: string
  endsOn?: string
  notes?: string
}

export function normaliseClassCode(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

const day = (value: string | undefined) => (value ?? '').trim() || null
const note = (value: string | undefined) => (value ?? '').trim() || null

/** True when both dates are set and the end is before the start (`date_range_invalid`). */
export function invalidDateRange(startsOn: string | undefined, endsOn: string | undefined): boolean {
  const start = day(startsOn)
  const end = day(endsOn)
  return start !== null && end !== null && end < start
}

/** Initial form values of a loaded class (null → empty). */
export function classFormValuesOf(cls: AcademyClass): ClassFormValues {
  return {
    courseId: cls.course.id,
    code: cls.code,
    nameAr: cls.name.ar,
    nameEn: cls.name.en ?? '',
    capacity: cls.capacity,
    startsOn: cls.startsOn ?? '',
    endsOn: cls.endsOn ?? '',
    notes: cls.notes ?? '',
  }
}

export function buildCreateClassInput(values: ClassFormValues): CreateClassInput {
  const input: CreateClassInput = {
    courseId: values.courseId ?? '',
    code: normaliseClassCode(values.code),
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
    capacity: values.capacity ?? 0,
  }
  const startsOn = day(values.startsOn)
  const endsOn = day(values.endsOn)
  const notes = note(values.notes)
  if (startsOn) input.startsOn = startsOn
  if (endsOn) input.endsOn = endsOn
  if (notes) input.notes = notes
  return input
}

/** The smallest PATCH body (API-053), or null when nothing changed. */
export function planClassPatch(cls: AcademyClass, values: ClassFormValues): UpdateClassInput | null {
  const body: UpdateClassInput = {}
  const code = normaliseClassCode(values.code)
  if (code && code !== cls.code) body.code = code
  const name = localizedOf(values.nameAr, values.nameEn, cls.name.tr)
  if (name && !sameLabel(name, cls.name)) body.name = name
  if (values.capacity !== undefined && values.capacity !== null && values.capacity !== cls.capacity) body.capacity = values.capacity
  const startsOn = day(values.startsOn)
  if (startsOn !== cls.startsOn) body.startsOn = startsOn
  const endsOn = day(values.endsOn)
  if (endsOn !== cls.endsOn) body.endsOn = endsOn
  const notes = note(values.notes)
  if (notes !== cls.notes) body.notes = notes
  return Object.keys(body).length > 0 ? body : null
}

/** The fields of the edit form (the course is fixed after creation). */
const EDIT_FIELDS = ['code', 'nameAr', 'nameEn', 'capacity', 'startsOn', 'endsOn', 'notes'] as const

/**
 * Whether the edit form holds anything else than the class's own values (KI-052 — PR #66
 * review, note 1): typed values count even while invalid (an emptied required name is
 * unsaved work too), and changing a field back to its value counts as no change.
 */
export function classFormHasChanges(cls: AcademyClass, values: ClassFormValues): boolean {
  const initial = classFormValuesOf(cls)
  return EDIT_FIELDS.some((field) => (values[field] ?? '') !== (initial[field] ?? ''))
}
