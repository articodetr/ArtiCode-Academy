import { describe, expect, it } from 'vitest'
import { EXAM_LESSON, EXAM_TIME_ZONE, makeExam } from '../test/exams'
import { examFormValuesOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { examFormHasChanges, isExamPatchField, lockedFieldUpdates, planExamPatch } from './exams.patch'

const exam = makeExam({ title: { ar: 'اختبار منتصف الفصل', en: 'Midterm exam', tr: 'Ara sınav' } })
const untouched = (): ExamFormValues => examFormValuesOf(exam)

describe('planExamPatch (the smallest PATCH — API-116)', () => {
  it('sends nothing for an untouched form, for spaces around a text and for a decimal typed with another number of zeros', () => {
    expect(planExamPatch(exam, untouched(), EXAM_TIME_ZONE)).toBeNull()
    expect(planExamPatch(exam, { ...untouched(), titleAr: ' اختبار منتصف الفصل ', maxScore: 50.0, weight: 30.0 }, EXAM_TIME_ZONE)).toBeNull()
  })

  it('sends only the changed fields; a localized text travels whole and keeps the Turkish text the form does not edit', () => {
    expect(planExamPatch(exam, { ...untouched(), titleEn: 'Midterm', type: 'final', durationMinutes: 90, maxScore: 60 }, EXAM_TIME_ZONE)).toEqual({
      title: { ar: 'اختبار منتصف الفصل', en: 'Midterm', tr: 'Ara sınav' },
      type: 'final',
      durationMinutes: 90,
      maxScore: 60,
    })
    expect(planExamPatch(exam, { ...untouched(), descriptionEn: 'Chapters 1–4' }, EXAM_TIME_ZONE)).toEqual({ description: { ar: 'الفصول 1 إلى 4', en: 'Chapters 1–4' } })
  })

  it('clears with null: description, lesson, date, duration, pass score and weight', () => {
    const linked = makeExam({ lesson: EXAM_LESSON })
    expect(
      planExamPatch(linked, { ...examFormValuesOf(linked), descriptionAr: '', lessonId: undefined, scheduledDate: '', scheduledTime: '', durationMinutes: null, passScore: null, weight: null }, EXAM_TIME_ZONE),
    ).toEqual({ description: null, lessonId: null, scheduledAt: null, durationMinutes: null, passScore: null, weight: null })
  })

  it('sends the date only when its date or time changed — as an instant of the zone typed in — and never a half date', () => {
    expect(planExamPatch(exam, { ...untouched(), scheduledTime: '11:30' }, EXAM_TIME_ZONE)).toEqual({ scheduledAt: '2026-11-20T08:30:00.000Z' })
    expect(planExamPatch(exam, { ...untouched(), scheduledTime: '' }, EXAM_TIME_ZONE)).toBeNull()
    // The same wall clock in a zone of another offset (a newly linked lesson in a London branch: 10:00 there is 10:00 UTC,
    // not the stored 07:00 UTC) keeps the stored instant — the date was not touched.
    expect(planExamPatch(exam, { ...untouched(), lessonId: EXAM_LESSON.id }, 'Europe/London')).toEqual({ lessonId: EXAM_LESSON.id })
    // A date typed for an undated exam.
    const undated = makeExam({ scheduledAt: null })
    expect(planExamPatch(undated, { ...examFormValuesOf(undated), scheduledDate: '2026-12-01', scheduledTime: '09:00' }, EXAM_TIME_ZONE)).toEqual({ scheduledAt: '2026-12-01T06:00:00.000Z' })
  })

  it('sends a maximum score only as a number, never a cleared one', () => {
    expect(planExamPatch(exam, { ...untouched(), maxScore: null }, EXAM_TIME_ZONE)).toBeNull()
    expect(planExamPatch(exam, { ...untouched(), passScore: 20.5 }, EXAM_TIME_ZONE)).toEqual({ passScore: 20.5 })
  })
})

describe('examFormHasChanges (the drawer’s unsaved-work guard)', () => {
  it('holds a real change, and what the save would refuse instead of sending; a change changed back holds nothing', () => {
    expect(examFormHasChanges(exam, untouched(), EXAM_TIME_ZONE)).toBe(false)
    expect(examFormHasChanges(exam, { ...untouched(), weight: 10 }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), titleAr: '  ' }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), descriptionAr: '', descriptionEn: 'Only English' }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), maxScore: null }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), scheduledTime: '' }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), weight: 30 }, EXAM_TIME_ZONE)).toBe(false)
  })
})

describe('lockedFieldUpdates (exam_locked { fields })', () => {
  it('puts the stored value back into each refused field with the message, and skips names the form does not render', () => {
    expect(lockedFieldUpdates(exam, ['maxScore', 'status'], 'locked')).toEqual([{ name: ['maxScore'], value: 50, errors: ['locked'] }])
    expect(lockedFieldUpdates(exam, ['scheduledAt'], 'locked')).toEqual([
      { name: ['scheduledDate'], value: '2026-11-20', errors: ['locked'] },
      { name: ['scheduledTime'], value: '10:00', errors: [] },
    ])
    expect(isExamPatchField('maxScore')).toBe(true)
    expect(isExamPatchField('status')).toBe(false)
  })
})
