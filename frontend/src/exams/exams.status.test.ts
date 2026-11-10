import { describe, expect, it } from 'vitest'
import { CLASS_STATUSES } from '../api/classes'
import type { ClassStatus } from '../api/classes'
import { EXAM_STATUSES, EXAM_STATUS_ACTIONS } from '../api/exams'
import { makeExam } from '../test/exams'
import {
  actionNeedsLiveClass,
  allowedExamActions,
  availableExamActions,
  examEditability,
  isClassFrozenForExams,
  isClassOpenForNewExam,
  isDangerousExamAction,
  isExamDeletable,
  lockedExamFields,
  nextExamStatus,
  resultCountOf,
} from './exams.status'

const classOf = (status: ClassStatus) => ({ ...makeExam().class, status })
const withResults = (students: number) => ({ students, scored: students, absent: 0, excused: 0 })

describe('exams.status (mirror of backend/src/exams/exams.status.ts and the class rules of exams.policy.ts)', () => {
  it('moves draft → scheduled → published and back with the four actions only (D-R47)', () => {
    expect(nextExamStatus('schedule', 'draft')).toBe('scheduled')
    expect(nextExamStatus('unschedule', 'scheduled')).toBe('draft')
    expect(nextExamStatus('publish', 'scheduled')).toBe('published')
    expect(nextExamStatus('unpublish', 'published')).toBe('scheduled')
    // Everything else is the server's invalid_transition.
    const allowed = EXAM_STATUSES.flatMap((from) => EXAM_STATUS_ACTIONS.filter((action) => nextExamStatus(action, from) !== null).map((action) => `${action}:${from}`))
    expect(allowed).toEqual(['schedule:draft', 'unschedule:scheduled', 'publish:scheduled', 'unpublish:published'])
    expect(allowedExamActions('draft')).toEqual(['schedule'])
    expect(allowedExamActions('scheduled')).toEqual(['unschedule', 'publish'])
    expect(allowedExamActions('published')).toEqual(['unpublish'])
  })

  it('creates exams for planned, open and running classes, and freezes the exams of a cancelled class only', () => {
    expect(CLASS_STATUSES.filter(isClassOpenForNewExam)).toEqual(['planned', 'open', 'running'])
    expect(CLASS_STATUSES.filter(isClassFrozenForExams)).toEqual(['cancelled'])
    expect(EXAM_STATUS_ACTIONS.filter(actionNeedsLiveClass)).toEqual(['schedule', 'publish'])
  })

  it('deletes a draft or scheduled exam without results only, and locks the maximum score once a result exists', () => {
    expect(isExamDeletable('draft', 0)).toBe(true)
    expect(isExamDeletable('scheduled', 0)).toBe(true)
    expect(isExamDeletable('scheduled', 1)).toBe(false)
    expect(isExamDeletable('published', 0)).toBe(false)
    expect(lockedExamFields(0, ['maxScore', 'title'])).toEqual([])
    expect(lockedExamFields(3, ['title', 'maxScore', 'weight'])).toEqual(['maxScore'])
    expect(resultCountOf(makeExam({ results: withResults(4) }))).toBe(4)
  })

  it('opens the edit form for exams.manage unless the class is cancelled — a completed class keeps its exams open (D-R33)', () => {
    expect(examEditability(makeExam(), true)).toEqual({ editable: true, maxScoreLocked: false })
    expect(examEditability(makeExam({ status: 'published', results: withResults(2) }), true)).toEqual({ editable: true, maxScoreLocked: true })
    expect(examEditability(makeExam({ class: classOf('completed') }), true).editable).toBe(true)
    expect(examEditability(makeExam({ class: classOf('cancelled') }), true).editable).toBe(false)
    expect(examEditability(makeExam(), false).editable).toBe(false)
  })

  it('offers the allowed actions: none without exams.manage, no schedule/publish for a cancelled class, no unschedule with results, delete while deletable', () => {
    expect(availableExamActions(makeExam(), false)).toEqual([])
    expect(availableExamActions(makeExam({ status: 'draft' }), true)).toEqual(['schedule', 'delete'])
    expect(availableExamActions(makeExam({ status: 'scheduled' }), true)).toEqual(['unschedule', 'publish', 'delete'])
    expect(availableExamActions(makeExam({ status: 'scheduled', results: withResults(1) }), true)).toEqual(['publish'])
    expect(availableExamActions(makeExam({ status: 'published', results: withResults(1) }), true)).toEqual(['unpublish'])
    // A cancelled class: an exam can still go back to draft, have its results hidden and be deleted.
    expect(availableExamActions(makeExam({ status: 'draft', class: classOf('cancelled') }), true)).toEqual(['delete'])
    expect(availableExamActions(makeExam({ status: 'scheduled', class: classOf('cancelled') }), true)).toEqual(['unschedule', 'delete'])
    expect(availableExamActions(makeExam({ status: 'published', class: classOf('cancelled'), results: withResults(2) }), true)).toEqual(['unpublish'])
    // A completed class keeps every action.
    expect(availableExamActions(makeExam({ status: 'scheduled', class: classOf('completed') }), true)).toEqual(['unschedule', 'publish', 'delete'])
    expect(isDangerousExamAction('delete')).toBe(true)
    expect(EXAM_STATUS_ACTIONS.some(isDangerousExamAction)).toBe(false)
  })
})
