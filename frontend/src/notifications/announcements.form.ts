// Pure rules of the announcement composer (J-F54 — MOD-12-T07, API-173): the
// form values, the local checks that mirror the server's (so a body the server
// would refuse is never sent), the request body, and whether the form holds
// unsaved work. Mirrors of backend/src/notifications/announcements.dto.ts
// (HasCharacters: 1..200 / 1..4,000 code points AFTER trimming, no NUL) and
// announcements.audience.ts (checkAudience: a class audience needs a class
// and at least one group and carries no role keys; an academy audience needs
// 1..4 distinct role keys and carries nothing of a class) — keep in sync. No
// React, no i18n — unit-tested in announcements.form.test.ts.
import { ANNOUNCEMENT_BODY_MAX_LENGTH, ANNOUNCEMENT_CLASS_GROUPS, ANNOUNCEMENT_ROLE_KEYS, ANNOUNCEMENT_TITLE_MAX_LENGTH } from '../api/announcements'
import type { AnnouncementClassGroup, AnnouncementRoleKey, CreateAnnouncementInput } from '../api/announcements'

export type AnnouncementKind = 'class' | 'academy'

/** The composer's form values (blank = not typed yet). */
export interface AnnouncementFormValues {
  kind: AnnouncementKind
  classId?: string
  groups: AnnouncementClassGroup[]
  roleKeys: AnnouncementRoleKey[]
  title: string
  body: string
  sendEmail: boolean
}

/** A new announcement: a class audience to its students and their guardians, unless the caller may only address the academy. */
export function initialAnnouncementValues(kind: AnnouncementKind = 'class'): AnnouncementFormValues {
  return { kind, classId: undefined, groups: ['students', 'guardians'], roleKeys: [], title: '', body: '', sendEmail: false }
}

/** Characters as PostgreSQL's char_length() counts them — code points, the way the server's HasCharacters() does. */
export function characterCount(text: string): number {
  return [...text].length
}

export type TextProblem = 'required' | 'max' | 'nul'

/** Why the server would refuse a title or a body (measured after trimming, like the server); null when it would not. */
export function textProblem(value: string | undefined, max: number): TextProblem | null {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) return 'required'
  if (characterCount(trimmed) > max) return 'max'
  if (trimmed.includes('\u0000')) return 'nul'
  return null
}

export const titleProblem = (value: string | undefined) => textProblem(value, ANNOUNCEMENT_TITLE_MAX_LENGTH)
export const bodyProblem = (value: string | undefined) => textProblem(value, ANNOUNCEMENT_BODY_MAX_LENGTH)

/** The groups in the composer's fixed order, each once. */
function orderedGroups(groups: readonly string[]): AnnouncementClassGroup[] {
  return ANNOUNCEMENT_CLASS_GROUPS.filter((group) => groups.includes(group))
}

/** The role keys in the order a normalised audience lists them, each once. */
function orderedRoleKeys(keys: readonly string[]): AnnouncementRoleKey[] {
  return ANNOUNCEMENT_ROLE_KEYS.filter((key) => keys.includes(key))
}

/** The fields whose values the server would refuse, in form order (the composer checks the same through its rules). */
export function announcementProblems(values: AnnouncementFormValues): Array<keyof AnnouncementFormValues> {
  const problems: Array<keyof AnnouncementFormValues> = []
  if (values.kind === 'class') {
    if (!values.classId) problems.push('classId')
    if (orderedGroups(values.groups).length === 0) problems.push('groups')
  } else if (orderedRoleKeys(values.roleKeys).length === 0) {
    problems.push('roleKeys')
  }
  if (titleProblem(values.title)) problems.push('title')
  if (bodyProblem(values.body)) problems.push('body')
  return problems
}

/**
 * The body of API-173, or null when the form still breaks a rule. A class audience spells out its three
 * groups; an academy audience carries its role keys alone — a class field there, even `false`, is
 * `class_fields_not_allowed`. The texts are trimmed (the server trims and stores them so).
 */
export function buildCreateAnnouncementInput(values: AnnouncementFormValues): CreateAnnouncementInput | null {
  if (announcementProblems(values).length > 0) return null
  const groups = orderedGroups(values.groups)
  const audience: CreateAnnouncementInput['audience'] =
    values.kind === 'class'
      ? { kind: 'class', classId: values.classId as string, students: groups.includes('students'), guardians: groups.includes('guardians'), teachers: groups.includes('teachers') }
      : { kind: 'academy', roleKeys: orderedRoleKeys(values.roleKeys) }
  return { audience, title: values.title.trim(), body: values.body.trim(), sendEmail: values.sendEmail === true }
}

/** The values compared for unsaved work: what a send would carry, so a change changed back holds nothing. */
function comparable(values: AnnouncementFormValues) {
  return {
    kind: values.kind,
    classId: values.kind === 'class' ? (values.classId ?? null) : null,
    groups: values.kind === 'class' ? orderedGroups(values.groups ?? []) : [],
    roleKeys: values.kind === 'academy' ? orderedRoleKeys(values.roleKeys ?? []) : [],
    title: (values.title ?? '').trim(),
    body: (values.body ?? '').trim(),
    sendEmail: values.sendEmail === true,
  }
}

/** Whether the composer holds unsaved work: anything a send would carry differs from the session's start. */
export function announcementFormHasChanges(initial: AnnouncementFormValues, values: AnnouncementFormValues): boolean {
  return JSON.stringify(comparable(initial)) !== JSON.stringify(comparable(values))
}
