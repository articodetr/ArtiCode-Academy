// Level form ↔ API bodies (MOD-04-T06) on the pattern of courses.form.ts: the
// create body carries only what was filled in, the PATCH body only what
// changed (null clears the description, a localized text travels whole and
// keeps a Turkish text the form does not show), nothing changed → null.
import type { CreateLevelInput, Level, UpdateLevelInput } from '../api/levels'
import { localizedOf, normaliseCourseCode, sameLabel } from './courses.form'

/** Level codes: trimmed and upper-cased, 1–16 of A–Z 0–9 . _ - (mirror of LEVEL_CODE_PATTERN). */
export const LEVEL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,15}$/
export const LEVEL_CODE_MAX_LENGTH = 16

export interface LevelFormValues {
  code: string
  nameAr: string
  nameEn?: string
  descriptionAr?: string
  descriptionEn?: string
  isActive: boolean
}

export const EMPTY_LEVEL_FORM: LevelFormValues = { code: '', nameAr: '', nameEn: '', descriptionAr: '', descriptionEn: '', isActive: true }

export function levelFormValuesOf(level: Level): LevelFormValues {
  return {
    code: level.code,
    nameAr: level.name.ar,
    nameEn: level.name.en ?? '',
    descriptionAr: level.description?.ar ?? '',
    descriptionEn: level.description?.en ?? '',
    isActive: level.isActive,
  }
}

export function buildCreateLevelInput(values: LevelFormValues): CreateLevelInput {
  const input: CreateLevelInput = {
    code: normaliseCourseCode(values.code),
    name: localizedOf(values.nameAr, values.nameEn) ?? { ar: values.nameAr.trim() },
  }
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (description) input.description = description
  // The server creates active levels by default: send the flag only to create an inactive one.
  if (values.isActive === false) input.isActive = false
  return input
}

/** The smallest PATCH body (API-039), or null when nothing changed. */
export function planLevelPatch(level: Level, values: LevelFormValues): UpdateLevelInput | null {
  const body: UpdateLevelInput = {}
  const code = normaliseCourseCode(values.code)
  if (code && code !== level.code) body.code = code
  const name = localizedOf(values.nameAr, values.nameEn, level.name.tr)
  if (name && !sameLabel(name, level.name)) body.name = name
  const description = localizedOf(values.descriptionAr, values.descriptionEn, level.description?.tr)
  if (!sameLabel(description, level.description)) body.description = description
  if (values.isActive !== level.isActive) body.isActive = values.isActive
  return Object.keys(body).length > 0 ? body : null
}

/** The full order (API-041) after moving one level up (-1) or down (+1); null at the edges. */
export function moveLevel(levels: readonly Level[], index: number, delta: -1 | 1): string[] | null {
  const target = index + delta
  if (index < 0 || index >= levels.length || target < 0 || target >= levels.length) return null
  const ids = levels.map((level) => level.id)
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  return ids
}
