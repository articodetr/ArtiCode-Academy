import { describe, expect, it } from 'vitest'
import { CLASS_ID } from '../test/classes'
import {
  announcementFormHasChanges,
  announcementProblems,
  bodyProblem,
  buildCreateAnnouncementInput,
  characterCount,
  initialAnnouncementValues,
  titleProblem,
} from './announcements.form'
import type { AnnouncementFormValues } from './announcements.form'

function values(overrides: Partial<AnnouncementFormValues> = {}): AnnouncementFormValues {
  return { ...initialAnnouncementValues(), classId: CLASS_ID, title: 'تأجيل درس الغد', body: 'يُؤجَّل درس الغد.', ...overrides }
}

describe('announcements.form', () => {
  it('starts a class audience to the students and their guardians, without e-mail', () => {
    expect(initialAnnouncementValues()).toEqual({ kind: 'class', classId: undefined, groups: ['students', 'guardians'], roleKeys: [], title: '', body: '', sendEmail: false })
    expect(initialAnnouncementValues('academy').kind).toBe('academy')
  })

  it('counts characters as code points, the way the server and the database count them', () => {
    // Two hearts written U+2764 U+FE0F are four code points (HasCharacters, char_length) — not two.
    expect(characterCount('❤️❤️')).toBe(4)
    expect(characterCount('😀')).toBe(1)
    expect('😀'.length).toBe(2)
  })

  it('measures the title and the body after trimming, up to 200 and 4,000 characters, without NUL', () => {
    expect(titleProblem('   ')).toBe('required')
    expect(titleProblem(undefined)).toBe('required')
    expect(titleProblem(`  ${'ب'.repeat(200)}  `)).toBeNull()
    expect(titleProblem('ب'.repeat(201))).toBe('max')
    // 200 emoji are 400 UTF-16 units but 200 characters: accepted.
    expect(titleProblem('😀'.repeat(200))).toBeNull()
    expect(titleProblem('a\u0000b')).toBe('nul')
    expect(bodyProblem('ن'.repeat(4000))).toBeNull()
    expect(bodyProblem('ن'.repeat(4001))).toBe('max')
  })

  it('names the fields a send would be refused for, as checkAudience() and the DTO would', () => {
    expect(announcementProblems(values())).toEqual([])
    expect(announcementProblems(values({ classId: undefined, groups: [] }))).toEqual(['classId', 'groups'])
    expect(announcementProblems(values({ kind: 'academy', roleKeys: [] }))).toEqual(['roleKeys'])
    expect(announcementProblems(values({ title: ' ', body: '' }))).toEqual(['title', 'body'])
  })

  it('spells out the three groups of a class audience and trims the texts', () => {
    expect(buildCreateAnnouncementInput(values({ groups: ['teachers', 'students'], title: '  عنوان  ', body: '\nنص\n', sendEmail: true }))).toEqual({
      audience: { kind: 'class', classId: CLASS_ID, students: true, guardians: false, teachers: true },
      title: 'عنوان',
      body: 'نص',
      sendEmail: true,
    })
  })

  it('sends an academy audience with its role keys alone, in the fixed order — never a class field', () => {
    const input = buildCreateAnnouncementInput(values({ kind: 'academy', roleKeys: ['staff', 'student', 'staff'] }))
    expect(input?.audience).toEqual({ kind: 'academy', roleKeys: ['student', 'staff'] })
    expect(Object.keys(input?.audience ?? {})).toEqual(['kind', 'roleKeys'])
    expect(buildCreateAnnouncementInput(values({ kind: 'academy', roleKeys: [] }))).toBeNull()
    expect(buildCreateAnnouncementInput(values({ title: '' }))).toBeNull()
  })

  it('holds unsaved work only while what a send would carry differs from the start', () => {
    const initial = initialAnnouncementValues()
    expect(announcementFormHasChanges(initial, { ...initial })).toBe(false)
    expect(announcementFormHasChanges(initial, { ...initial, title: '   ' })).toBe(false)
    expect(announcementFormHasChanges(initial, { ...initial, body: 'نص' })).toBe(true)
    expect(announcementFormHasChanges(initial, { ...initial, classId: CLASS_ID })).toBe(true)
    expect(announcementFormHasChanges(initial, { ...initial, groups: ['guardians', 'students'] })).toBe(false)
    expect(announcementFormHasChanges(initial, { ...initial, kind: 'academy' })).toBe(true)
    // Back to the class kind: the academy keys picked meanwhile are not part of what a send would carry.
    expect(announcementFormHasChanges(initial, { ...initial, roleKeys: ['staff'] })).toBe(false)
    expect(announcementFormHasChanges(initial, { ...initial, sendEmail: true })).toBe(true)
  })
})
