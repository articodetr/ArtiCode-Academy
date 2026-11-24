// PORTAL-04 — the school subjects' form helpers (a mirror of levels.form.test.ts) and the course form's subject choices.
import { describe, expect, it } from 'vitest'
import { THREE_SUBJECTS, makeSubject } from '../test/subjects'
import { SUBJECT_CODE_PATTERN, buildCreateSubjectInput, moveSubject, planSubjectPatch, subjectChoicesFor, subjectFormValuesOf } from './subjects.form'

describe('subject form helpers (PORTAL-04)', () => {
  it('builds the create body from what was filled in only; isActive travels only to create an inactive subject', () => {
    expect(buildCreateSubjectInput({ code: ' math ', nameAr: ' الرياضيات ', nameEn: '', isActive: true })).toEqual({ code: 'MATH', name: { ar: 'الرياضيات' } })
    expect(buildCreateSubjectInput({ code: 'ART', nameAr: 'الفنون', nameEn: 'Arts', isActive: false })).toEqual({ code: 'ART', name: { ar: 'الفنون', en: 'Arts' }, isActive: false })
  })

  it('sends no PATCH without a difference, and only the changed fields otherwise (keeping the Turkish name)', () => {
    const subject = makeSubject({ name: { ar: 'البرمجة', en: 'Programming', tr: 'Programlama' } })
    expect(planSubjectPatch(subject, subjectFormValuesOf(subject))).toBeNull()
    // The code is normalised before comparing: «prog» is the stored «PROG».
    expect(planSubjectPatch(subject, { ...subjectFormValuesOf(subject), code: 'prog' })).toBeNull()
    expect(planSubjectPatch(subject, { ...subjectFormValuesOf(subject), nameEn: 'Coding', isActive: false })).toEqual({
      name: { ar: 'البرمجة', en: 'Coding', tr: 'Programlama' },
      isActive: false,
    })
    expect(planSubjectPatch(subject, { ...subjectFormValuesOf(subject), code: 'cs' })).toEqual({ code: 'CS' })
  })

  it('mirrors the server code rule: 1–16 Latin letters, digits and . _ -, starting with a letter or digit', () => {
    for (const good of ['M', 'MATH', 'CS-101', 'A.B_C', 'X'.repeat(16)]) expect(SUBJECT_CODE_PATTERN.test(good), good).toBe(true)
    for (const bad of ['', '-A', 'X'.repeat(17), 'رياضيات', 'A B']) expect(SUBJECT_CODE_PATTERN.test(bad), bad).toBe(false)
  })

  it('moves one subject up or down as a full permutation, and refuses the edges', () => {
    const subjects = THREE_SUBJECTS()
    const ids = subjects.map((subject) => subject.id)
    expect(moveSubject(subjects, 0, 1)).toEqual([ids[1], ids[0], ids[2]])
    expect(moveSubject(subjects, 2, -1)).toEqual([ids[0], ids[2], ids[1]])
    expect(moveSubject(subjects, 0, -1)).toBeNull()
    expect(moveSubject(subjects, 2, 1)).toBeNull()
  })

  it('offers the subjects read, plus the course’s own subject when the list lacks it — never twice', () => {
    const subjects = THREE_SUBJECTS()
    expect(subjectChoicesFor(subjects, null).map((choice) => choice.id)).toEqual(subjects.map((subject) => subject.id))
    expect(subjectChoicesFor(subjects, { id: subjects[1]!.id, code: 'MATH', name: { ar: 'الرياضيات' } })).toHaveLength(3)
    const hidden = { id: 'hidden', code: 'OLD', name: { ar: 'قديمة' } }
    expect(subjectChoicesFor([], hidden)).toEqual([hidden])
    expect(subjectChoicesFor(subjects, hidden).at(-1)).toEqual(hidden)
  })
})
