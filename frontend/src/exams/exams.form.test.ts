import { describe, expect, it } from 'vitest'
import { EXAM_LESSON, EXAM_TIME_ZONE, makeExam, makeOnlineExam } from '../test/exams'
import { NEW_EXAM_FORM_VALUES, buildCreateExamInput, closesAtOf, examFormValuesOf, scheduledAtOf } from './exams.form'
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
      // MOD-09 phase 2: a manual exam holds the defaults of the online settings.
      delivery: 'manual',
      closesDate: '',
      closesTime: '',
      attemptsAllowed: 1,
      resultsRelease: 'on_publish',
      revealAnswers: false,
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

describe('exams.form — the online settings (MOD-09 phase 2)', () => {
  it('starts an edit session of an online exam with its settings, the closing as the wall clock of the exam’s zone', () => {
    expect(examFormValuesOf(makeOnlineExam({ resultsRelease: 'on_submit', revealAnswers: true }))).toMatchObject({
      delivery: 'online',
      // The window: 07:00–09:00 UTC is 10:00–12:00 in Asia/Riyadh.
      scheduledDate: '2026-11-20',
      scheduledTime: '10:00',
      closesDate: '2026-11-20',
      closesTime: '12:00',
      durationMinutes: 30,
      attemptsAllowed: 2,
      resultsRelease: 'on_submit',
      revealAnswers: true,
    })
    expect(examFormValuesOf(makeOnlineExam({ closesAt: null }))).toMatchObject({ closesDate: '', closesTime: '' })
  })

  it('turns the closing date and time into an instant of the zone they were typed in; both blank = not set, one half = refused', () => {
    expect(closesAtOf({ closesDate: '2026-11-20', closesTime: '12:00' }, EXAM_TIME_ZONE)).toBe('2026-11-20T09:00:00.000Z')
    expect(closesAtOf({ closesDate: '', closesTime: '' }, EXAM_TIME_ZONE)).toBeNull()
    expect(closesAtOf({}, EXAM_TIME_ZONE)).toBeNull()
    expect(closesAtOf({ closesDate: '2026-11-20' }, EXAM_TIME_ZONE)).toBeUndefined()
  })

  it('starts a new exam as a manual one, with the server’s defaults of the online settings ready', () => {
    expect(NEW_EXAM_FORM_VALUES).toEqual({ delivery: 'manual', attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false })
  })

  it('builds a manual exam’s body exactly as before: no delivery and no online setting, whatever the hidden fields hold', () => {
    const manual = buildCreateExamInput({ ...base, ...NEW_EXAM_FORM_VALUES }, EXAM_TIME_ZONE)
    expect(manual).toEqual({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 20 })
    // Values left behind by a switch to online and back.
    const switchedBack = buildCreateExamInput({ ...base, delivery: 'manual', closesDate: '2026-11-20', closesTime: '12:00', attemptsAllowed: 3, resultsRelease: 'on_submit', revealAnswers: true }, EXAM_TIME_ZONE)
    expect(switchedBack).toEqual({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 20 })
    for (const field of ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers']) expect(switchedBack).not.toHaveProperty(field)
  })

  it('builds an online exam’s body: delivery, the window, the time limit and the settings as JSON number and boolean', () => {
    const body = buildCreateExamInput(
      { ...base, ...NEW_EXAM_FORM_VALUES, delivery: 'online', scheduledDate: '2026-11-20', scheduledTime: '10:00', closesDate: '2026-11-20', closesTime: '12:00', durationMinutes: 30, attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true },
      EXAM_TIME_ZONE,
    )
    expect(body).toEqual({
      title: { ar: 'اختبار قصير' },
      type: 'quiz',
      maxScore: 20,
      scheduledAt: '2026-11-20T07:00:00.000Z',
      durationMinutes: 30,
      delivery: 'online',
      closesAt: '2026-11-20T09:00:00.000Z',
      attemptsAllowed: 2,
      resultsRelease: 'on_submit',
      revealAnswers: true,
    })
    expect(typeof body.attemptsAllowed).toBe('number')
    expect(typeof body.revealAnswers).toBe('boolean')
  })

  it('creates an online draft without a window yet, with the defaults the form showed', () => {
    expect(buildCreateExamInput({ ...base, ...NEW_EXAM_FORM_VALUES, delivery: 'online', closesDate: '', closesTime: '' }, EXAM_TIME_ZONE)).toEqual({
      title: { ar: 'اختبار قصير' },
      type: 'quiz',
      maxScore: 20,
      delivery: 'online',
      attemptsAllowed: 1,
      resultsRelease: 'on_publish',
      revealAnswers: false,
    })
  })
})
