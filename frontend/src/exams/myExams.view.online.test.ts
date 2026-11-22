// MOD-09 phase 2 (OEX-T07) — the online side of a «my exams» row: what the row
// offers comes from the SERVER's state of the item (`inProgress`, `canStart`,
// `blocker`), never from this device's clock. The rules of a manual row are in
// myExams.view.test.ts, untouched.
import { describe, expect, it } from 'vitest'
import { TAKE_BLOCKERS } from '../api/myExams'
import { ATTEMPT_ID } from '../test/myAttempts'
import { makeMyExam, makeMyExamOnline, makeMyExamResult, makeOnlineMyExam, makePublishedMyExam } from '../test/myExams'
import { isOnlineItem, onlineResultCellOf, resultCellOf, takeStateOf } from './myExams.view'

describe('isOnlineItem', () => {
  it('is true for an online exam with its online side only: a manual exam’s row has none', () => {
    expect(isOnlineItem(makeOnlineMyExam())).toBe(true)
    expect(isOnlineItem(makeMyExam())).toBe(false)
    expect(isOnlineItem(makePublishedMyExam())).toBe(false)
    // Defensive: an item that names itself online without the side has nothing to offer.
    expect(isOnlineItem({ ...makeMyExam(), delivery: 'online', online: null })).toBe(false)
  })
})

describe('takeStateOf (the row state of an online exam)', () => {
  it('resumes the attempt in progress, as the server described it', () => {
    const inProgress = { id: ATTEMPT_ID, attemptNo: 1, expiresAt: '2026-11-20T08:00:00.000Z', remainingSeconds: 754 }
    expect(takeStateOf(makeMyExamOnline({ attemptsUsed: 1, inProgress }))).toEqual({ kind: 'resume', attempt: inProgress })
    // The attempt in progress is resumed even when it is the last one allowed.
    expect(takeStateOf(makeMyExamOnline({ attemptsAllowed: 1, attemptsUsed: 1, inProgress })).kind).toBe('resume')
  })

  it('starts the next attempt — the number after those used — and knows the last one', () => {
    expect(takeStateOf(makeMyExamOnline({ attemptsAllowed: 3, attemptsUsed: 0 }))).toEqual({ kind: 'start', attemptNo: 1, last: false })
    expect(takeStateOf(makeMyExamOnline({ attemptsAllowed: 3, attemptsUsed: 1 }))).toEqual({ kind: 'start', attemptNo: 2, last: false })
    expect(takeStateOf(makeMyExamOnline({ attemptsAllowed: 3, attemptsUsed: 2 }))).toEqual({ kind: 'start', attemptNo: 3, last: true })
    expect(takeStateOf(makeMyExamOnline({ attemptsAllowed: 1, attemptsUsed: 0 }))).toEqual({ kind: 'start', attemptNo: 1, last: true })
  })

  it.each(TAKE_BLOCKERS)('names the server’s reason when the exam cannot be taken: %s', (blocker) => {
    expect(takeStateOf(makeMyExamOnline({ canStart: false, blocker }))).toEqual({ kind: 'blocked', blocker })
  })

  it('never decides by itself: without `canStart` nothing starts, whatever the window and the attempts look like', () => {
    // The window looks open and an attempt looks left, but the server said no and named no reason.
    expect(takeStateOf(makeMyExamOnline({ canStart: false, blocker: null, attemptsUsed: 0, attemptsAllowed: 5 }))).toEqual({ kind: 'unavailable' })
    // The server said yes: the row offers it without a second opinion about the window.
    expect(takeStateOf(makeMyExamOnline({ canStart: true, closesAt: '2020-01-01T00:00:00.000Z' })).kind).toBe('start')
  })
})

describe('onlineResultCellOf (the result column of an online exam)', () => {
  it('shows a released result exactly as a manual exam’s', () => {
    const item = makeOnlineMyExam({ result: makeMyExamResult({ score: 8, feedback: null }) }, { resultsRelease: 'on_submit' })
    expect(onlineResultCellOf(item)).toEqual(resultCellOf(item))
    expect(onlineResultCellOf(item)).toEqual({ kind: 'result', status: 'scored', score: 8 })
  })

  it('waits for the submit, not for the publication, when the exam releases on submit', () => {
    expect(onlineResultCellOf(makeOnlineMyExam({}, { resultsRelease: 'on_submit' }))).toEqual({ kind: 'afterSubmit' })
    expect(onlineResultCellOf(makeOnlineMyExam({}, { resultsRelease: 'on_publish' }))).toEqual({ kind: 'awaiting' })
  })

  it('says «no result» for a published exam without one, whatever its release', () => {
    expect(onlineResultCellOf(makeOnlineMyExam({ status: 'published' }, { resultsRelease: 'on_submit', canStart: false, blocker: 'results_published' }))).toEqual({ kind: 'none' })
  })
})
