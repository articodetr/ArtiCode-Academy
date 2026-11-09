import { describe, expect, it } from 'vitest'
import { ASSIGNMENT_TIME_ZONE, LINKED_LESSON, makeAssignment } from '../test/assignments'
import { assignmentFormValuesOf, buildCreateAssignmentInput, NEW_ASSIGNMENT_VALUES } from './assignments.form'
import type { AssignmentFormValues } from './assignments.form'
import { lockedFieldUpdates, planAssignmentPatch } from './assignments.patch'
import { instantIn } from './assignments.zone'

const stored = makeAssignment({ title: { ar: 'تمارين الحلقات', en: 'Loop exercises', tr: 'Döngü alıştırmaları' }, lesson: LINKED_LESSON, latePenaltyPercent: null })
const values = (overrides: Partial<AssignmentFormValues> = {}): AssignmentFormValues => ({ ...assignmentFormValuesOf(stored), ...overrides })

describe('assignmentFormValuesOf / buildCreateAssignmentInput', () => {
  it('fills the form from the assignment, the due date as the wall clock of its own zone', () => {
    expect(assignmentFormValuesOf(stored)).toEqual({
      classId: stored.class.id,
      lessonId: LINKED_LESSON.id,
      titleAr: 'تمارين الحلقات',
      titleEn: 'Loop exercises',
      instructionsAr: 'حلّ تمارين الصفحة 12',
      instructionsEn: '',
      maxScore: 20,
      weight: 10,
      dueDate: '2026-11-20',
      dueTime: '23:59',
      allowLate: false,
      latePenaltyPercent: null,
      maxAttempts: 1,
    })
    expect(assignmentFormValuesOf(makeAssignment({ dueAt: null, instructions: null })).dueDate).toBe('')
  })

  it('creates with what was filled in and what differs from the server defaults only', () => {
    const minimal = buildCreateAssignmentInput({ ...NEW_ASSIGNMENT_VALUES, titleAr: ' واجب ', maxScore: 20 } as AssignmentFormValues, ASSIGNMENT_TIME_ZONE)
    expect(minimal).toEqual({ title: { ar: 'واجب' }, maxScore: 20 })
    const full = buildCreateAssignmentInput(
      {
        classId: 'c-1',
        lessonId: 'l-1',
        titleAr: 'واجب',
        titleEn: 'Homework',
        instructionsAr: 'حلّ',
        instructionsEn: 'Solve',
        maxScore: 12.5,
        weight: 0,
        dueDate: '2026-11-20',
        dueTime: '23:59',
        allowLate: true,
        latePenaltyPercent: 0,
        maxAttempts: 3,
      },
      'Europe/Istanbul',
    )
    expect(full).toEqual({
      title: { ar: 'واجب', en: 'Homework' },
      instructions: { ar: 'حلّ', en: 'Solve' },
      lessonId: 'l-1',
      maxScore: 12.5,
      weight: 0,
      dueAt: instantIn('2026-11-20', '23:59', 'Europe/Istanbul'),
      allowLate: true,
      latePenaltyPercent: 0,
      maxAttempts: 3,
    })
    expect(full.dueAt).toBe('2026-11-20T20:59:00.000Z')
  })
})

describe('planAssignmentPatch — the smallest PATCH (API-105)', () => {
  it('sends nothing when nothing changed — the decimals compared at two decimals', () => {
    expect(planAssignmentPatch(stored, values(), ASSIGNMENT_TIME_ZONE)).toBeNull()
    expect(planAssignmentPatch(makeAssignment({ maxScore: 12.5 }), { ...assignmentFormValuesOf(makeAssignment({ maxScore: 12.5 })), maxScore: 12.5 }, ASSIGNMENT_TIME_ZONE)).toBeNull()
  })

  it('sends the changed fields only; the title keeps the Turkish text the form does not edit', () => {
    expect(planAssignmentPatch(stored, values({ titleAr: 'الحلقات', maxAttempts: 2 }), ASSIGNMENT_TIME_ZONE)).toEqual({
      title: { ar: 'الحلقات', en: 'Loop exercises', tr: 'Döngü alıştırmaları' },
      maxAttempts: 2,
    })
  })

  it('clears with null: instructions, lesson, weight, due date and late penalty', () => {
    const penalised = makeAssignment({ allowLate: true, latePenaltyPercent: 15, lesson: LINKED_LESSON })
    const cleared = { ...assignmentFormValuesOf(penalised), instructionsAr: '', lessonId: undefined, weight: null, dueDate: '', dueTime: '', latePenaltyPercent: null }
    expect(planAssignmentPatch(penalised, cleared, ASSIGNMENT_TIME_ZONE)).toEqual({ instructions: null, lessonId: null, weight: null, dueAt: null, latePenaltyPercent: null })
  })

  it('sends a moved due date as the instant of the wall clock in the given zone', () => {
    expect(planAssignmentPatch(stored, values({ dueTime: '18:00' }), ASSIGNMENT_TIME_ZONE)).toEqual({ dueAt: '2026-11-20T15:00:00.000Z' })
    // Another lesson in another zone: the time typed is read there.
    expect(planAssignmentPatch(stored, values({ lessonId: 'l-2', dueTime: '18:00' }), 'Europe/London')).toEqual({ lessonId: 'l-2', dueAt: '2026-11-20T18:00:00.000Z' })
  })

  it('keeps the stored instant when the wall clock was left as it was, even when the zone moved with another lesson', () => {
    const withSeconds = makeAssignment({ dueAt: '2026-11-20T20:59:30.000Z' })
    expect(planAssignmentPatch(withSeconds, assignmentFormValuesOf(withSeconds), ASSIGNMENT_TIME_ZONE)).toBeNull()
    expect(planAssignmentPatch(stored, values({ lessonId: 'l-2' }), 'Europe/London')).toEqual({ lessonId: 'l-2' })
  })

  it('maps assignment_locked back onto the form: the stored values return, the first input of each field carries the message', () => {
    expect(lockedFieldUpdates(stored, ['maxScore', 'allowLate', 'dueAt', 'unknown'], 'مقفل')).toEqual([
      { name: ['maxScore'], value: 20, errors: ['مقفل'] },
      { name: ['allowLate'], value: false, errors: ['مقفل'] },
      { name: ['dueDate'], value: '2026-11-20', errors: ['مقفل'] },
      { name: ['dueTime'], value: '23:59', errors: [] },
    ])
  })
})
