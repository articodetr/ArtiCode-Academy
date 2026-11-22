import { describe, expect, it } from 'vitest'
import { CLASS_STATUSES } from '../api/classes'
import type { ClassStatus } from '../api/classes'
import { EXAM_STATUSES, EXAM_STATUS_ACTIONS } from '../api/exams'
import type { ExamStatus } from '../api/exams'
import { makeExam, makeOnlineExam, makeOnlineSummary } from '../test/exams'
import {
  NO_ONLINE_LOCKS,
  actionNeedsLiveClass,
  allowedExamActions,
  availableExamActions,
  examEditability,
  isClassFrozenForExams,
  isClassOpenForNewExam,
  isDangerousExamAction,
  isExamDeletable,
  lockedExamFields,
  lockedOnlineFields,
  lockedOnlineFieldsOf,
  nextExamStatus,
  onlineExamLocks,
  resultCountOf,
  startedStudentsOf,
} from './exams.status'
import type { OnlineLockState, OnlineLockValues } from './exams.status'

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

// --- MOD-09 phase 2 ------------------------------------------------------------

const started = (students: number) => makeOnlineSummary({ frozen: true, attempts: { students, inProgress: 0, finished: students } })

describe('exams.status — an online exam (mirror of moveOnlineExam() and of remove())', () => {
  it('counts the students who have started: none for a manual exam or an online one nobody took', () => {
    expect(startedStudentsOf(makeExam())).toBe(0)
    expect(startedStudentsOf(makeOnlineExam())).toBe(0)
    expect(startedStudentsOf(makeOnlineExam({ status: 'scheduled', online: started(3) }))).toBe(3)
    expect(startedStudentsOf({})).toBe(0)
  })

  it('offers an online exam the same actions as a manual one until somebody has started', () => {
    expect(availableExamActions(makeOnlineExam({ status: 'draft' }), true)).toEqual(['schedule', 'delete'])
    expect(availableExamActions(makeOnlineExam({ status: 'scheduled' }), true)).toEqual(['unschedule', 'publish', 'delete'])
    expect(availableExamActions(makeOnlineExam({ status: 'published' }), true)).toEqual(['unpublish'])
    expect(availableExamActions(makeOnlineExam({ status: 'scheduled' }), false)).toEqual([])
  })

  it('offers neither unschedule nor delete once somebody has started — even without any result yet', () => {
    const taken = makeOnlineExam({ status: 'scheduled', online: started(1) })
    expect(resultCountOf(taken)).toBe(0)
    expect(availableExamActions(taken, true)).toEqual(['publish'])
    // A cancelled class takes no publish either: nothing is left.
    expect(availableExamActions({ ...taken, class: classOf('cancelled') }, true)).toEqual([])
    expect(availableExamActions(makeOnlineExam({ status: 'published', online: started(1) }), true)).toEqual(['unpublish'])
    expect(isExamDeletable('scheduled', 0, 1)).toBe(false)
    expect(isExamDeletable('scheduled', 0, 0)).toBe(true)
    expect(isExamDeletable('draft', 0)).toBe(true)
  })
})

describe('lockedOnlineFields (mirror of backend/src/exams/exams.online.ts)', () => {
  const state = (status: ExamStatus, attemptCount = 0, delivery: OnlineLockState['delivery'] = 'online'): OnlineLockState => ({ status, delivery, attemptCount })
  const current: OnlineLockValues = { scheduledAt: '2026-11-20T07:00:00.000Z', closesAt: '2026-11-20T09:00:00.000Z', durationMinutes: 30, attemptsAllowed: 2 }
  const everything = { maxScore: 20, scheduledAt: '2026-11-21T07:00:00.000Z', closesAt: '2026-11-21T09:00:00.000Z', durationMinutes: 45, attemptsAllowed: 3 }

  it('locks nothing in a draft: every setting changes or is cleared, the delivery included', () => {
    expect(lockedOnlineFields(state('draft'), current, { ...everything, delivery: 'manual' })).toEqual([])
    expect(lockedOnlineFields(state('draft'), current, { scheduledAt: null, closesAt: null, durationMinutes: null, attemptsAllowed: 1 })).toEqual([])
    expect(lockedOnlineFields(state('draft', 0, 'manual'), current, { delivery: 'online' })).toEqual([])
  })

  it('locks the delivery outside a draft — and that is the whole refusal, for a manual exam too', () => {
    for (const status of ['scheduled', 'published'] as const) {
      expect(lockedOnlineFields(state(status), current, { delivery: 'manual', maxScore: 20, closesAt: null })).toEqual(['delivery'])
      expect(lockedOnlineFields(state(status, 0, 'manual'), current, { delivery: 'online' })).toEqual(['delivery'])
    }
  })

  it('once the learners see an online exam: the maximum score is frozen and the opening, the closing and the time limit cannot be cleared — they still move', () => {
    for (const status of ['scheduled', 'published'] as const) {
      expect(lockedOnlineFields(state(status), current, { maxScore: 20 })).toEqual(['maxScore'])
      expect(lockedOnlineFields(state(status), current, { scheduledAt: null, closesAt: null, durationMinutes: null })).toEqual(['scheduledAt', 'closesAt', 'durationMinutes'])
      expect(lockedOnlineFields(state(status), current, { scheduledAt: everything.scheduledAt, closesAt: '2026-11-20T08:00:00.000Z', durationMinutes: 45, attemptsAllowed: 1 })).toEqual([])
    }
  })

  it('once somebody has started: the opening and the time limit are fixed, the closing only moves later, the attempts only rise', () => {
    const taken = state('scheduled', 3)
    expect(lockedOnlineFields(taken, current, { scheduledAt: everything.scheduledAt })).toEqual(['scheduledAt'])
    expect(lockedOnlineFields(taken, current, { durationMinutes: 45 })).toEqual(['durationMinutes'])
    expect(lockedOnlineFields(taken, current, { closesAt: '2026-11-20T08:59:59.000Z' })).toEqual(['closesAt'])
    expect(lockedOnlineFields(taken, current, { closesAt: '2026-11-20T09:00:00.000Z' })).toEqual([])
    expect(lockedOnlineFields(taken, current, { closesAt: '2026-11-20T10:00:00.000Z' })).toEqual([])
    expect(lockedOnlineFields(taken, current, { closesAt: null })).toEqual(['closesAt'])
    expect(lockedOnlineFields(taken, current, { attemptsAllowed: 1 })).toEqual(['attemptsAllowed'])
    expect(lockedOnlineFields(taken, current, { attemptsAllowed: 2 })).toEqual([])
    expect(lockedOnlineFields(taken, current, { attemptsAllowed: 5 })).toEqual([])
    // All at once, in the server's order.
    expect(lockedOnlineFields(taken, current, { ...everything, closesAt: '2026-11-20T08:00:00.000Z', attemptsAllowed: 1 })).toEqual(['scheduledAt', 'closesAt', 'durationMinutes', 'maxScore', 'attemptsAllowed'])
  })

  it('refuses a manual exam nothing here (its own rule locks the maximum score after a first result)', () => {
    expect(lockedOnlineFields(state('published', 0, 'manual'), { ...current, closesAt: null }, { maxScore: 20, scheduledAt: null, durationMinutes: null })).toEqual([])
  })
})

describe('lockedOnlineFieldsOf and onlineExamLocks (what the edit form asks of the mirror)', () => {
  const available = makeOnlineExam({ status: 'scheduled' })
  const taken = makeOnlineExam({ status: 'scheduled', online: started(2) })

  it('feeds the mirror with the exam as loaded and the fields the planned PATCH names', () => {
    expect(lockedOnlineFieldsOf(makeOnlineExam(), { delivery: 'manual' })).toEqual([])
    expect(lockedOnlineFieldsOf(makeExam({ status: 'scheduled' }), { delivery: 'online' })).toEqual(['delivery'])
    expect(lockedOnlineFieldsOf(available, { title: { ar: 'عنوان' }, resultsRelease: 'on_submit', revealAnswers: true })).toEqual([])
    expect(lockedOnlineFieldsOf(available, { maxScore: 12, closesAt: null })).toEqual(['closesAt', 'maxScore'])
    expect(lockedOnlineFieldsOf(taken, { scheduledAt: '2026-11-20T06:00:00.000Z', closesAt: '2026-11-20T10:00:00.000Z', attemptsAllowed: 1 })).toEqual(['scheduledAt', 'attemptsAllowed'])
    expect(lockedOnlineFieldsOf(taken, { closesAt: '2026-11-20T10:00:00.000Z', attemptsAllowed: 3 })).toEqual([])
    // A manual exam with results is the first rule's business, not this one's.
    expect(lockedOnlineFieldsOf(makeExam({ status: 'scheduled', results: withResults(2) }), { maxScore: 60 })).toEqual([])
  })

  it('tells the form its three situations: delivery fixed outside a draft, visible, started', () => {
    expect(onlineExamLocks(makeExam())).toEqual(NO_ONLINE_LOCKS)
    expect(onlineExamLocks(makeExam({ status: 'scheduled' }))).toEqual({ deliveryFixed: true, visible: false, started: false })
    expect(onlineExamLocks(makeOnlineExam())).toEqual({ deliveryFixed: false, visible: false, started: false })
    expect(onlineExamLocks(available)).toEqual({ deliveryFixed: true, visible: true, started: false })
    expect(onlineExamLocks(makeOnlineExam({ status: 'published' }))).toEqual({ deliveryFixed: true, visible: true, started: false })
    expect(onlineExamLocks(taken)).toEqual({ deliveryFixed: true, visible: true, started: true })
  })
})
