import { describe, expect, it } from 'vitest'
import { EXAM_LESSON, EXAM_TIME_ZONE, makeExam, makeOnlineExam, makeOnlineSummary } from '../test/exams'
import { examFormValuesOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { EXAM_PATCH_FIELDS, FORM_FIELDS_OF_PATCH_FIELD, examFormHasChanges, isExamPatchField, lockedFieldUpdates, patchFieldLabelKey, planExamPatch, reopensRevealedWindow, turnsManual } from './exams.patch'

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

// --- MOD-09 phase 2: the online side of the same PATCH -------------------------

const ONLINE_FIELDS = ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers'] as const
const online = makeOnlineExam()
const onlineUntouched = (): ExamFormValues => examFormValuesOf(online)
/** What a form showing a manual exam reports: the online inputs are not on screen. */
const withoutOnlineInputs = (values: ExamFormValues): ExamFormValues => ({ ...values, closesDate: undefined, closesTime: undefined, attemptsAllowed: undefined, resultsRelease: undefined, revealAnswers: undefined })

describe('planExamPatch — a manual exam never names an online setting (online_settings_not_allowed)', () => {
  it('sends nothing for an untouched manual exam, and no online field for any change of its own', () => {
    expect(planExamPatch(exam, untouched(), EXAM_TIME_ZONE)).toBeNull()
    const body = planExamPatch(exam, { ...untouched(), titleAr: 'عنوان آخر', maxScore: 60 }, EXAM_TIME_ZONE)!
    for (const field of ONLINE_FIELDS) expect(body).not.toHaveProperty(field)
    // The same when the form does not report the online inputs at all (they are not on screen for a manual exam).
    expect(planExamPatch(exam, withoutOnlineInputs(untouched()), EXAM_TIME_ZONE)).toBeNull()
    expect(planExamPatch(exam, { ...withoutOnlineInputs(untouched()), delivery: undefined }, EXAM_TIME_ZONE)).toBeNull()
  })

  it('ignores online values left in a manual form: a closing, attempts, a release policy, revealed answers', () => {
    expect(planExamPatch(exam, { ...untouched(), closesDate: '2026-11-21', closesTime: '12:00', attemptsAllowed: 3, resultsRelease: 'on_submit', revealAnswers: true }, EXAM_TIME_ZONE)).toBeNull()
  })

  it('turns an online draft manual with `delivery` alone — the server resets the settings and unlinks the questions', () => {
    const body = planExamPatch(online, { ...onlineUntouched(), delivery: 'manual' }, EXAM_TIME_ZONE)!
    expect(body).toEqual({ delivery: 'manual' })
    // Even with the online inputs changed before the switch.
    expect(planExamPatch(online, { ...onlineUntouched(), delivery: 'manual', closesTime: '13:00', attemptsAllowed: 5, revealAnswers: true }, EXAM_TIME_ZONE)).toEqual({ delivery: 'manual' })
    expect(turnsManual(online, body)).toBe(true)
    expect(turnsManual(online, { title: { ar: 'x' } })).toBe(false)
    expect(turnsManual(exam, { delivery: 'manual' })).toBe(false)
    expect(turnsManual(exam, { delivery: 'online' })).toBe(false)
  })
})

describe('planExamPatch — an online exam (the smallest PATCH)', () => {
  it('sends nothing for an untouched online exam', () => {
    expect(planExamPatch(online, onlineUntouched(), EXAM_TIME_ZONE)).toBeNull()
    // The inputs not on screen yet (the form said manual a moment ago): nothing to compare, nothing sent.
    expect(planExamPatch(online, withoutOnlineInputs(onlineUntouched()), EXAM_TIME_ZONE)).toBeNull()
  })

  it('turns a manual draft online: `delivery` and only the settings that differ from the stored defaults', () => {
    expect(planExamPatch(exam, { ...untouched(), delivery: 'online' }, EXAM_TIME_ZONE)).toEqual({ delivery: 'online' })
    expect(
      planExamPatch(exam, { ...untouched(), delivery: 'online', closesDate: '2026-11-20', closesTime: '12:00', attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true }, EXAM_TIME_ZONE),
    ).toEqual({ delivery: 'online', closesAt: '2026-11-20T09:00:00.000Z', attemptsAllowed: 2, resultsRelease: 'on_submit', revealAnswers: true })
  })

  it('sends each changed setting alone: the attempts as a number, the reveal as a boolean, the release policy', () => {
    expect(planExamPatch(online, { ...onlineUntouched(), attemptsAllowed: 3 }, EXAM_TIME_ZONE)).toEqual({ attemptsAllowed: 3 })
    expect(planExamPatch(online, { ...onlineUntouched(), revealAnswers: true }, EXAM_TIME_ZONE)).toEqual({ revealAnswers: true })
    expect(planExamPatch(online, { ...onlineUntouched(), resultsRelease: 'on_submit' }, EXAM_TIME_ZONE)).toEqual({ resultsRelease: 'on_submit' })
    // A cleared number of attempts is never sent (the form refuses it).
    expect(planExamPatch(online, { ...onlineUntouched(), attemptsAllowed: null }, EXAM_TIME_ZONE)).toBeNull()
  })

  it('sends the closing only when its date or time changed — as an instant of the zone typed in — clears it with null, and never a half', () => {
    expect(planExamPatch(online, { ...onlineUntouched(), closesTime: '13:30' }, EXAM_TIME_ZONE)).toEqual({ closesAt: '2026-11-20T10:30:00.000Z' })
    expect(planExamPatch(online, { ...onlineUntouched(), closesDate: '', closesTime: '' }, EXAM_TIME_ZONE)).toEqual({ closesAt: null })
    expect(planExamPatch(online, { ...onlineUntouched(), closesTime: '' }, EXAM_TIME_ZONE)).toBeNull()
    // The same wall clock in the zone of a newly linked lesson keeps the stored instant: only the lesson travels.
    expect(planExamPatch(online, { ...onlineUntouched(), lessonId: EXAM_LESSON.id }, 'Europe/London')).toEqual({ lessonId: EXAM_LESSON.id })
    // A closing typed for an online draft that had none.
    const open = makeOnlineExam({ closesAt: null })
    expect(planExamPatch(open, { ...examFormValuesOf(open), closesDate: '2026-11-20', closesTime: '12:00' }, EXAM_TIME_ZONE)).toEqual({ closesAt: '2026-11-20T09:00:00.000Z' })
    // The stored seconds of an untouched closing are no change.
    const seconds = makeOnlineExam({ closesAt: '2026-11-20T09:00:42.000Z' })
    expect(planExamPatch(seconds, examFormValuesOf(seconds), EXAM_TIME_ZONE)).toBeNull()
  })

  it('moves the window and the time limit with the first-phase fields they are: scheduledAt and durationMinutes', () => {
    expect(planExamPatch(online, { ...onlineUntouched(), scheduledTime: '09:00', durationMinutes: 45 }, EXAM_TIME_ZONE)).toEqual({ scheduledAt: '2026-11-20T06:00:00.000Z', durationMinutes: 45 })
  })
})

describe('examFormHasChanges — the online settings', () => {
  it('holds a changed setting and what the save would refuse — half a closing, emptied attempts; changed back holds nothing', () => {
    expect(examFormHasChanges(online, onlineUntouched(), EXAM_TIME_ZONE)).toBe(false)
    expect(examFormHasChanges(online, { ...onlineUntouched(), revealAnswers: true }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(online, { ...onlineUntouched(), revealAnswers: false }, EXAM_TIME_ZONE)).toBe(false)
    expect(examFormHasChanges(online, { ...onlineUntouched(), closesTime: '' }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(online, { ...onlineUntouched(), attemptsAllowed: null }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(online, { ...onlineUntouched(), delivery: 'manual' }, EXAM_TIME_ZONE)).toBe(true)
    expect(examFormHasChanges(exam, { ...untouched(), delivery: 'online' }, EXAM_TIME_ZONE)).toBe(true)
    // A manual form holds nothing for online values it does not show, and nothing while the inputs are not on screen yet.
    expect(examFormHasChanges(exam, { ...untouched(), attemptsAllowed: null, closesDate: '2026-11-21' }, EXAM_TIME_ZONE)).toBe(false)
    expect(examFormHasChanges(online, withoutOnlineInputs(onlineUntouched()), EXAM_TIME_ZONE)).toBe(false)
  })
})

describe('reopensRevealedWindow (KI-130 — the warning the server does not give)', () => {
  const closedAt = '2026-11-20T09:00:00.000Z'
  const now = Date.parse('2026-11-21T08:00:00.000Z')
  const revealed = makeOnlineExam({ status: 'scheduled', revealAnswers: true, closesAt: closedAt })
  const later = { closesAt: '2026-11-22T09:00:00.000Z' }

  it('warns when the closing of a closed window moves later on an exam that reveals its answers', () => {
    expect(reopensRevealedWindow(revealed, later, now)).toBe(true)
    expect(reopensRevealedWindow({ ...revealed, status: 'published' }, later, now)).toBe(true)
    // Switching the reveal off in the same save takes nothing back: the stored setting counts.
    expect(reopensRevealedWindow(revealed, { ...later, revealAnswers: false }, now)).toBe(true)
    // The window closed exactly now.
    expect(reopensRevealedWindow(revealed, later, Date.parse(closedAt))).toBe(true)
  })

  it('stays silent otherwise: a window still open, no revealed answers, a draft, a manual exam, a closing left alone, cleared or moved earlier', () => {
    expect(reopensRevealedWindow(revealed, later, Date.parse(closedAt) - 1)).toBe(false)
    expect(reopensRevealedWindow({ ...revealed, revealAnswers: false }, later, now)).toBe(false)
    expect(reopensRevealedWindow({ ...revealed, status: 'draft' }, later, now)).toBe(false)
    expect(reopensRevealedWindow(makeExam({ status: 'scheduled' }), later, now)).toBe(false)
    expect(reopensRevealedWindow({ ...revealed, closesAt: null }, later, now)).toBe(false)
    expect(reopensRevealedWindow(revealed, { revealAnswers: false }, now)).toBe(false)
    expect(reopensRevealedWindow(revealed, { closesAt: null }, now)).toBe(false)
    expect(reopensRevealedWindow(revealed, { closesAt: '2026-11-20T08:00:00.000Z' }, now)).toBe(false)
    expect(reopensRevealedWindow(revealed, { closesAt: closedAt }, now)).toBe(false)
  })
})

describe('lockedFieldUpdates — the online fields of exam_locked', () => {
  const started = makeOnlineExam({ status: 'scheduled', online: makeOnlineSummary({ frozen: true, attempts: { students: 2, inProgress: 1, finished: 1 } }) })

  it('maps every PATCH field to its form fields, the online ones included, and names them from the right dictionary', () => {
    expect(EXAM_PATCH_FIELDS).toEqual(['title', 'description', 'type', 'lessonId', 'scheduledAt', 'durationMinutes', 'maxScore', 'passScore', 'weight', ...ONLINE_FIELDS])
    expect(FORM_FIELDS_OF_PATCH_FIELD.closesAt).toEqual(['closesDate', 'closesTime'])
    expect(ONLINE_FIELDS.every(isExamPatchField)).toBe(true)
    expect(patchFieldLabelKey('maxScore')).toBe('exams.patchFields.maxScore')
    expect(ONLINE_FIELDS.map(patchFieldLabelKey)).toEqual(ONLINE_FIELDS.map((field) => `examOnline.patchFields.${field}`))
  })

  it('puts the stored window, time limit, attempts and delivery back, each with its own message', () => {
    expect(lockedFieldUpdates(started, ['scheduledAt', 'closesAt', 'durationMinutes', 'attemptsAllowed', 'delivery'], (field) => `why:${field}`)).toEqual([
      { name: ['scheduledDate'], value: '2026-11-20', errors: ['why:scheduledAt'] },
      { name: ['scheduledTime'], value: '10:00', errors: [] },
      { name: ['closesDate'], value: '2026-11-20', errors: ['why:closesAt'] },
      { name: ['closesTime'], value: '12:00', errors: [] },
      { name: ['durationMinutes'], value: 30, errors: ['why:durationMinutes'] },
      { name: ['attemptsAllowed'], value: 2, errors: ['why:attemptsAllowed'] },
      { name: ['delivery'], value: 'online', errors: ['why:delivery'] },
    ])
  })
})
