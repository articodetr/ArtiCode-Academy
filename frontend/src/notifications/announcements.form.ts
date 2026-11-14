// Pure rules of the new-announcement form (API-173): the values, the local
// mirrors of the server's checks (CreateAnnouncementDto: 1..200 / 1..4,000
// code points after trimming, no NUL; checkAudience(): a class audience needs
// a class and at least one group, an academy audience 1..4 distinct role keys)
// and the request body. Keep in sync with
// backend/src/notifications/announcements.{dto,audience}.ts.
import { ANNOUNCEMENT_BODY_MAX_LENGTH, ANNOUNCEMENT_ROLE_KEYS, ANNOUNCEMENT_TITLE_MAX_LENGTH } from '../api/announcements'
import type { AnnouncementClassGroup, AnnouncementRoleKey, CreateAnnouncementInput } from '../api/announcements'

export type AnnouncementKind = 'class' | 'academy'

export interface AnnouncementFormValues {
  kind: AnnouncementKind
  classId?: string
  groups: AnnouncementClassGroup[]
  roleKeys: AnnouncementRoleKey[]
  title: string
  body: string
  sendEmail: boolean
}

export function initialAnnouncementValues(): AnnouncementFormValues {
  return { kind: 'class', classId: undefined, groups: ['students', 'guardians'], roleKeys: [], title: '', body: '', sendEmail: false }
}

/** Characters as PostgreSQL's char_length() counts them: code points. */
export function characterCount(text: string): number {
  return [...text].length
}

export type TextProblem = 'required' | 'max' | 'nul'

/** Why the server would refuse a title or body (after trimming, like the server), or null. */
export function textProblem(value: string | undefined, max: number): TextProblem | null {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) return 'required'
  if (trimmed.includes('\u0000')) return 'nul'
  if (characterCount(trimmed) > max) return 'max'
  return null
}

export const titleProblem = (value: string | undefined) => textProblem(value, ANNOUNCEMENT_TITLE_MAX_LENGTH)
export const bodyProblem = (value: string | undefined) => textProblem(value, ANNOUNCEMENT_BODY_MAX_LENGTH)

/** The body of API-173: the audience of the chosen kind only, the texts trimmed, the groups spelled out. */
export function buildAnnouncementInput(values: AnnouncementFormValues): CreateAnnouncementInput {
  const audience: CreateAnnouncementInput['audience'] =
    values.kind === 'class'
      ? {
          kind: 'class',
          classId: values.classId ?? '',
          students: values.groups.includes('students'),
          guardians: values.groups.includes('guardians'),
          teachers: values.groups.includes('teachers'),
        }
      : { kind: 'academy', roleKeys: ANNOUNCEMENT_ROLE_KEYS.filter((key) => values.roleKeys.includes(key)) }
  return { audience, title: values.title.trim(), body: values.body.trim(), sendEmail: values.sendEmail }
}

/** The form holds something worth asking about before it is thrown away. */
export function announcementFormHasChanges(values: Partial<AnnouncementFormValues>): boolean {
  return Boolean(values.title?.trim() || values.body?.trim() || values.classId)
}
