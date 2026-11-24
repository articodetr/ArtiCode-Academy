// Subject form ↔ API bodies (PORTAL-04) on the pattern of levels.form.ts: the create body carries only what was filled
// in, the PATCH body only what changed (a localized name travels whole and keeps a Turkish text the form does not show),
// nothing changed → null. A subject has no description. Also the choices of the course form's subject picker.
import type { CourseSubject } from '../api/courses'
import type { CreateSubjectInput, Subject, UpdateSubjectInput } from '../api/subjects'
import { localizedOf, normaliseCourseCode, sameLabel } from './courses.form'
import { LEVEL_CODE_MAX_LENGTH, LEVEL_CODE_PATTERN } from './levels.form'

/** Subject codes follow the level code rule (SUBJECT_CODE_PATTERN = LEVEL_CODE_PATTERN on the server): 1–16 characters. */
export const SUBJECT_CODE_PATTERN = LEVEL_CODE_PATTERN
export const SUBJECT_CODE_MAX_LENGTH = LEVEL_CODE_MAX_LENGTH

export interface SubjectFormValues {
  code: string
  nameAr: string
  nameEn?: string
  isActive: boolean
}

export const EMPTY_SUBJECT_FORM: SubjectFormValues = { code: '', nameAr: '', nameEn: '', isActive: true }

export function subjectFormValuesOf(subject: Subject): SubjectFormValues {
  return { code: subject.code, nameAr: subject.name.ar, nameEn: subject.name.en ?? '', isActive: subject.isActive }
}

export function buildCreateSubjectInput(values: SubjectFormValues): CreateSubjectInput {
  const input: CreateSubjectInput = {
    code: normaliseCourseCode(values.code),
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
  }
  // The server creates active subjects by default: send the flag only to create an inactive one.
  if (values.isActive === false) input.isActive = false
  return input
}

/** The smallest PATCH body, or null when nothing changed. */
export function planSubjectPatch(subject: Subject, values: SubjectFormValues): UpdateSubjectInput | null {
  const body: UpdateSubjectInput = {}
  const code = normaliseCourseCode(values.code)
  if (code && code !== subject.code) body.code = code
  const name = localizedOf(values.nameAr, values.nameEn, subject.name.tr)
  if (name && !sameLabel(name, subject.name)) body.name = name
  if (values.isActive !== subject.isActive) body.isActive = values.isActive
  return Object.keys(body).length > 0 ? body : null
}

/** The full order after moving one subject up (-1) or down (+1); null at the edges. */
export function moveSubject(subjects: readonly Subject[], index: number, delta: -1 | 1): string[] | null {
  const target = index + delta
  if (index < 0 || index >= subjects.length || target < 0 || target >= subjects.length) return null
  const ids = subjects.map((subject) => subject.id)
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  return ids
}

/** One choice of the course form's subject picker. */
export interface SubjectChoice {
  id: string
  code: string
  name: Subject['name']
  /** Unknown (a subject the list did not bring) reads as active: nothing is said about it. */
  isActive?: boolean
}

/**
 * The picker's choices: the subjects read, plus the course's own subject when the list lacks it (a failed read, or a
 * subject hidden from this reader), so the picker names it instead of showing a raw id.
 */
export function subjectChoicesFor(subjects: readonly Subject[], current: CourseSubject | null | undefined): SubjectChoice[] {
  const choices: SubjectChoice[] = [...subjects]
  if (current && !subjects.some((subject) => subject.id === current.id)) choices.push({ id: current.id, code: current.code, name: current.name })
  return choices
}
