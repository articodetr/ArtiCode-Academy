import { describe, expect, it } from 'vitest'
import { EXAM_LESSON, EXAM_TIME_ZONE, makeExam } from '../test/exams'
import { buildCreateExamInput, examFormValuesOf, scheduledAtOf } from './exams.form'
import type { ExamFormValues } from './exams.form'

const base: ExamFormValues = { classId: 'c-1', titleAr: ' اختبار قصير ', type: 'quiz', maxScore: 20 }

describe('exams.form (form ↔ API-115 body)', () => {
  it('starts an edit session from the exam as the server holds it, its date as the wall clock of its own zone', () => {
    expect(examFormValuesOf(makeExam({ lesson: EXAM_LESSON }))).toEqual({
      classId: makeExam().class.id,
      lessonId: EXAM_LESSON.id,
      titleAr: 'اختبار منتصف الفصل',
      titleEn: 'Midterm exam',
      descriptionAr: 'الفصول 1 إلى 4',
      descriptionEn: '',
      type: 'midterm',
      // 07:00 UTC is 10:00 in Asia/Riyadh.
      scheduledDate: '2026-11-20',
      scheduledTime: '10:00',
      durationMinutes: 60,
      maxScore: 50,
      passScore: 25,
      weight: 30,
    })
    expect(examFormValuesOf(makeExam({ scheduledAt: null, description: null }))).toMatchObject({ scheduledDate: '', scheduledTime: '', descriptionAr: '' })
  })

  it('turns the date and the time into an instant of the zone they were typed in; both blank = undated, one half = refused', () => {
    expect(scheduledAtOf({ scheduledDate: '2026-11-20', scheduledTime: '10:00' }, EXAM_TIME_ZONE)).toBe('2026-11-20T07:00:00.000Z')
    expect(scheduledAtOf({ scheduledDate: '2026-11-20', scheduledTime: '10:00' }, 'UTC')).toBe('2026-11-20T10:00:00.000Z')
    expect(scheduledAtOf({ scheduledDate: '', scheduledTime: '' }, EXAM_TIME_ZONE)).toBeNull()
    expect(scheduledAtOf({ scheduledDate: '2026-11-20', scheduledTime: '' }, EXAM_TIME_ZONE)).toBeUndefined()
  })

  it('sends the trimmed title, the type and the maximum score, and only what else was filled in', () => {
    expect(buildCreateExamInput(base, EXAM_TIME_ZONE)).toEqual({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 20 })
    expect(
      buildCreateExamInput(
        {
          ...base,
          titleEn: ' Quiz ',
          descriptionAr: 'الوحدة الأولى',
          lessonId: EXAM_LESSON.id,
          scheduledDate: '2026-11-20',
          scheduledTime: '10:00',
          durationMinutes: 45,
          passScore: 10,
          weight: 15.5,
        },
        EXAM_TIME_ZONE,
      ),
    ).toEqual({
      title: { ar: 'اختبار قصير', en: 'Quiz' },
      type: 'quiz',
      maxScore: 20,
      description: { ar: 'الوحدة الأولى' },
      lessonId: EXAM_LESSON.id,
      scheduledAt: '2026-11-20T07:00:00.000Z',
      durationMinutes: 45,
      passScore: 10,
      weight: 15.5,
    })
    // A pass score or a weight of 0 is a value, not a blank.
    expect(buildCreateExamInput({ ...base, passScore: 0, weight: 0, durationMinutes: null }, EXAM_TIME_ZONE)).toEqual({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 20, passScore: 0, weight: 0 })
  })
})
