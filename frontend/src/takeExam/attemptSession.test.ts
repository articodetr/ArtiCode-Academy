// MOD-09 phase 2 (OEX-T07) — one sitting of an attempt, without React: the
// requests it makes and in which order, with every answer of the server under
// the test's control. Proves: one save at a time, coalesced; a failed save
// keeps its answers and retries with a growing pause; attempt_closed and
// answers_invalid; a submit that waits for the saves and never goes out over
// unsaved answers; the end of the time submitting once; the flush with
// keepalive; the re-read that follows the server's clock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { AnswerEntry, MyAttempt, SaveAnswersResult } from '../api/myAttempts'
import { ATTEMPT_ID, OPTION_IDS, QUESTION_IDS, makeAnsweredQuestions, makeAttemptResult, makeFinishedAttempt, makeMyAttempt, makeSaveResult } from '../test/myAttempts'
import { DRAIN_BUDGET_MS, FLUSH_BUDGET_MS, FLUSH_REPEAT_GAP_MS, RESYNC_MIN_GAP_MS, SAVE_TIMEOUT_MS, createAttemptSession } from './attemptSession'
import { booleanAnswer, choiceAnswer } from './takeExam.answers'
import { secondsLeft } from './takeExam.clock'

const [Q1, Q2, Q3] = QUESTION_IDS
const A = choiceAnswer(OPTION_IDS.first[0])
const B = choiceAnswer(OPTION_IDS.first[1])
const C = choiceAnswer(OPTION_IDS.first[2])

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface SaveCall extends Deferred<SaveAnswersResult> {
  answers: AnswerEntry[]
  keepalive: boolean
}

function refusal(status: number, code?: string, details: Record<string, unknown> = {}, retryAfterSeconds: number | null = null) {
  return new ApiError(status, 'refused', { statusCode: status, ...(code ? { code } : {}), message: 'refused', ...details }, retryAfterSeconds)
}

/** Lets every promise chain that can run now run. */
async function settle() {
  for (let round = 0; round < 12; round += 1) await Promise.resolve()
}

/** The timers of the session (vitest's fake ones) move on by `ms`, with the promise chains in between. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

function setup() {
  const clock = { now: 10_000 }
  const reads: Deferred<MyAttempt>[] = []
  const saves: SaveCall[] = []
  const submits: Deferred<MyAttempt>[] = []
  const session = createAttemptSession(ATTEMPT_ID, {
    now: () => clock.now,
    getAttempt: () => {
      const read = deferred<MyAttempt>()
      reads.push(read)
      return read.promise
    },
    saveAnswers: (_attemptId, answers, options) => {
      const save = { ...deferred<SaveAnswersResult>(), answers, keepalive: options.keepalive === true }
      // A save given up by the session (its timeout) fails like an aborted request.
      options.signal?.addEventListener('abort', () => save.reject(new DOMException('aborted', 'AbortError')))
      saves.push(save)
      return save.promise
    },
    submitAttempt: () => {
      const submit = deferred<MyAttempt>()
      submits.push(submit)
      return submit.promise
    },
  })
  return { session, clock, reads, saves, submits, view: () => session.getSnapshot() }
}

/** A session whose first read answered `attempt`. */
async function opened(attempt: MyAttempt = makeMyAttempt()) {
  const harness = setup()
  harness.session.start()
  harness.reads[0]!.resolve(attempt)
  await settle()
  return harness
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening an attempt', () => {
  it('reads it once and takes the server’s answers and its time left, anchored on the monotonic clock', async () => {
    const harness = setup()
    harness.session.start()
    expect(harness.view().status).toBe('loading')
    harness.clock.now = 10_400 // the answer arrives 400 ms later
    harness.reads[0]!.resolve(makeMyAttempt({ questions: makeAnsweredQuestions(), remainingSeconds: 1200 }))
    await settle()

    const view = harness.view()
    expect(view.status).toBe('answering')
    expect(view.clock).toEqual({ remainingSeconds: 1200, at: 10_400 })
    expect(view.answers.get(Q1)).toEqual(B)
    expect(view.answers.get(Q2)).toBeNull()
    expect(view.answers.get(Q3)).toEqual(booleanAnswer(true))
    expect(view.save).toEqual({ state: 'saved', failure: null, unsaved: false })
    expect(harness.reads).toHaveLength(1)
    expect(harness.saves).toHaveLength(0)
    expect(harness.submits).toHaveLength(0)
  })

  it('shows a finished attempt as the server sent it: no clock, nothing to save, nothing ended here', async () => {
    const finished = makeFinishedAttempt({ resultReleased: true, result: makeAttemptResult() })
    const harness = await opened(finished)
    const view = harness.view()
    expect(view.status).toBe('finished')
    expect(view.attempt).toBe(finished)
    expect(view.clock).toBeNull()
    expect(view.endedBy).toBeNull()
    expect(view.lostAnswers).toEqual([])
    harness.session.answer(Q1, A)
    harness.session.timeElapsed()
    await harness.session.submit()
    expect(harness.saves).toHaveLength(0)
    expect(harness.submits).toHaveLength(0)
  })

  it('tells a 404 (not theirs, or gone) from a failure a retry may fix', async () => {
    const gone = setup()
    gone.session.start()
    gone.reads[0]!.reject(refusal(404, 'attempt_not_found'))
    await settle()
    expect(gone.view().status).toBe('not_found')

    // An id no attempt can have (a mistyped link): the first read's 400 is as good as not found.
    const mistyped = setup()
    mistyped.session.start()
    mistyped.reads[0]!.reject(refusal(400, undefined, { message: 'Validation failed (uuid is expected)' }))
    await settle()
    expect(mistyped.view().status).toBe('not_found')

    const failed = setup()
    failed.session.start()
    failed.reads[0]!.reject(new TypeError('Failed to fetch'))
    await settle()
    expect(failed.view().status).toBe('failed')
    expect(failed.view().loadFailure?.key).toBe('login.errors.network')
    failed.session.reload()
    expect(failed.view().status).toBe('loading')
    failed.reads[1]!.resolve(makeMyAttempt())
    await settle()
    expect(failed.view().status).toBe('answering')
  })
})

describe('answers that save themselves', () => {
  it('shows a chosen answer at once and sends ONE save with the whole answer of that question', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)

    expect(harness.view().answers.get(Q1)).toEqual(B)
    expect(harness.view().save).toEqual({ state: 'saving', failure: null, unsaved: true })
    expect(harness.saves).toHaveLength(1)
    expect(harness.saves[0]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])
    expect(harness.saves[0]!.keepalive).toBe(false)

    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    expect(harness.view().save.state).toBe('saved')
    expect(harness.saves).toHaveLength(1)
  })

  it('coalesces the changes made while a save is on its way into one more request — the last answer of each question', async () => {
    const harness = await opened()
    harness.session.answer(Q1, A)
    harness.session.answer(Q1, B)
    harness.session.answer(Q3, booleanAnswer(true))
    harness.session.answer(Q1, C)
    harness.session.answer(Q3, null)
    expect(harness.saves).toHaveLength(1) // one request at a time
    expect(harness.saves[0]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[0] }])

    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    expect(harness.saves).toHaveLength(2)
    // The newest answer of the first question, and the third one cleared: an entry with neither field.
    expect(harness.saves[1]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[2] }, { examQuestionId: Q3 }])
    expect(harness.view().save.state).toBe('saving')

    harness.saves[1]!.resolve(makeSaveResult())
    await settle()
    expect(harness.saves).toHaveLength(2)
    expect(harness.view().save.state).toBe('saved')
  })

  it('re-synchronises the clock from every save’s answer', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 1800 }))
    harness.clock.now = 40_000 // 30 s later the running clock shows 1770
    harness.session.answer(Q1, A)
    harness.clock.now = 40_100
    harness.saves[0]!.resolve(makeSaveResult({ remainingSeconds: 1765 })) // the server says less: adopted
    await settle()
    expect(harness.view().clock).toEqual({ remainingSeconds: 1765, at: 40_100 })
    expect(secondsLeft(harness.view().clock!, 40_100)).toBe(1765)
  })

  it('keeps the answers of a failed save and tries again by itself after a growing pause', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.saves[0]!.reject(new TypeError('Failed to fetch'))
    await settle()

    expect(harness.view().answers.get(Q1)).toEqual(B) // still on screen
    expect(harness.view().save.state).toBe('retrying')
    expect(harness.view().save.failure?.key).toBe('login.errors.network')
    expect(harness.view().save.unsaved).toBe(true)

    // A change made while waiting joins the retry instead of starting a request of its own.
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[0]))
    await advance(1_999)
    expect(harness.saves).toHaveLength(1)
    await advance(1)
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves[1]!.answers).toEqual([
      { examQuestionId: Q1, optionId: OPTION_IDS.first[1] },
      { examQuestionId: Q2, optionId: OPTION_IDS.second[0] },
    ])

    // A second failure in a row waits longer: 4 s, not 2.
    harness.saves[1]!.reject(refusal(503))
    await settle()
    expect(harness.view().save.failure?.key).toBe('login.errors.server')
    await advance(3_999)
    expect(harness.saves).toHaveLength(2)
    await advance(1)
    expect(harness.saves).toHaveLength(3)

    harness.saves[2]!.resolve(makeSaveResult())
    await settle()
    expect(harness.view().save).toEqual({ state: 'saved', failure: null, unsaved: false })
    await advance(60_000)
    expect(harness.saves).toHaveLength(3)
  })

  it('waits what a 429 asks before it tries again, and tries at once on «retry»', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.saves[0]!.reject(refusal(429, 'rate_limited', {}, 7))
    await settle()
    expect(harness.view().save.state).toBe('retrying')
    await advance(6_999)
    expect(harness.saves).toHaveLength(1)
    await advance(1)
    expect(harness.saves).toHaveLength(2)

    harness.saves[1]!.reject(refusal(429, 'rate_limited', {}, 30))
    await settle()
    harness.session.retrySave() // the learner does not wait
    expect(harness.saves).toHaveLength(3)
    expect(harness.view().save.state).toBe('saving')
    // The pause that was scheduled is gone with the manual retry.
    harness.saves[2]!.resolve(makeSaveResult())
    await settle()
    await advance(60_000)
    expect(harness.saves).toHaveLength(3)
  })

  it('gives up a save that gets no answer and tries it again', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    await advance(SAVE_TIMEOUT_MS - 1)
    expect(harness.view().save.state).toBe('saving')
    await advance(1)
    expect(harness.view().save.state).toBe('retrying')
    await advance(2_000)
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves[1]!.answers).toEqual(harness.saves[0]!.answers)
  })

  it('holds the answers on a refusal that waiting does not fix: no retry by itself, one on the learner’s word', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.saves[0]!.reject(refusal(403, 'permission_denied', { missing: ['exams.take'] }))
    await settle()
    expect(harness.view().save.state).toBe('held')
    expect(harness.view().save.failure?.code).toBe('permission_denied')
    await advance(120_000)
    expect(harness.saves).toHaveLength(1)
    harness.session.retrySave()
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves[1]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])
  })
})

describe('an attempt the server closed (409 attempt_closed)', () => {
  it('stops saving for good, reads the attempt again and shows it finished — naming the answer that did not arrive', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[0])) // waits behind the first save
    harness.saves[0]!.reject(refusal(409, 'attempt_closed', { status: 'timed_out' }))
    await settle()

    expect(harness.reads).toHaveLength(2)
    // The server kept «ثمانية» from an earlier save of the first question and nothing for the second.
    const closed = makeFinishedAttempt({ status: 'timed_out', questions: makeAnsweredQuestions() })
    harness.reads[1]!.resolve(closed)
    await settle()

    const view = harness.view()
    expect(view.status).toBe('finished')
    expect(view.attempt).toBe(closed)
    expect(view.endedBy).toBe('elsewhere')
    expect(view.lostAnswers).toEqual([2]) // the first question is what the server holds; the second never arrived
    expect(view.save.unsaved).toBe(false)

    harness.session.answer(Q3, booleanAnswer(false))
    harness.session.retrySave()
    await advance(120_000)
    expect(harness.saves).toHaveLength(1)
    expect(harness.submits).toHaveLength(0)
  })

  it('waits with «refresh» when the closed state cannot be read, and shows it once it can', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.saves[0]!.reject(refusal(409, 'attempt_closed', { status: 'submitted' }))
    await settle()
    harness.reads[1]!.reject(new TypeError('Failed to fetch'))
    await settle()
    expect(harness.view().status).toBe('stalled')
    expect(harness.view().endedBy).toBe('elsewhere')

    const refreshing = harness.session.refresh()
    expect(harness.view().refreshing).toBe(true)
    harness.reads[2]!.reject(new TypeError('Failed to fetch'))
    await refreshing
    expect(harness.view().status).toBe('stalled')
    expect(harness.view().refreshing).toBe(false)

    const again = harness.session.refresh()
    harness.reads[3]!.resolve(makeFinishedAttempt())
    await again
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('elsewhere')
    expect(harness.submits).toHaveLength(0)
  })

  it('does not go on answering into a closed queue when an older read still shows the attempt open', async () => {
    const harness = await opened()
    harness.session.pageVisible() // a read is on its way…
    harness.session.answer(Q1, B)
    harness.saves[0]!.reject(refusal(409, 'attempt_closed', { status: 'timed_out' })) // …when the server closes the attempt
    await settle()
    expect(harness.reads).toHaveLength(2)
    harness.reads[1]!.resolve(makeMyAttempt({ remainingSeconds: 3 })) // the older read: sent before the close
    await settle()
    // The read asked because of the close runs next and tells the truth.
    expect(harness.reads).toHaveLength(3)
    expect(harness.view().status).toBe('answering')
    harness.reads[2]!.resolve(makeFinishedAttempt({ status: 'timed_out' }))
    await settle()
    expect(harness.view().status).toBe('finished')
  })
})

describe('answers the server does not recognise (400 answers_invalid)', () => {
  it('drops what was queued, reads the attempt again, takes the server’s answers and says so', async () => {
    const harness = await opened()
    harness.session.answer(Q1, A)
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[2]))
    harness.saves[0]!.reject(refusal(400, 'answers_invalid', { unknown: [Q1], duplicates: [], malformed: [] }))
    await settle()
    expect(harness.view().answersReset).toBe(true)
    expect(harness.reads).toHaveLength(2)
    harness.reads[1]!.resolve(makeMyAttempt({ questions: makeAnsweredQuestions(), remainingSeconds: 1700 }))
    await settle()

    const view = harness.view()
    expect(view.status).toBe('answering')
    expect(view.answers.get(Q1)).toEqual(B) // the server's, not the refused one
    expect(view.answers.get(Q2)).toBeNull()
    expect(view.save.unsaved).toBe(false)
    expect(harness.saves).toHaveLength(1) // nothing is re-sent

    harness.session.dismissAnswersReset()
    expect(harness.view().answersReset).toBe(false)
    // Saving goes on from there.
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[1]))
    expect(harness.saves).toHaveLength(2)
  })
})

describe('the final submit', () => {
  it('locks the answers, waits for the save on its way, then submits exactly once', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    const submitting = harness.session.submit()
    expect(harness.view().status).toBe('submitting')
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[0])) // too late: locked
    expect(harness.view().answers.get(Q2)).toBeNull()
    await settle()
    expect(harness.submits).toHaveLength(0) // the save has not answered yet

    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    expect(harness.submits).toHaveLength(1)
    const finished = makeFinishedAttempt()
    harness.submits[0]!.resolve(finished)
    await submitting

    expect(harness.view().status).toBe('finished')
    expect(harness.view().attempt).toBe(finished)
    expect(harness.view().endedBy).toBe('self')
    expect(harness.view().lostAnswers).toEqual([])
    await harness.session.submit() // nothing left to submit
    expect(harness.submits).toHaveLength(1)
    expect(harness.saves).toHaveLength(1)
  })

  it('never submits over unsaved answers: a failed save stops it, and says so', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    const submitting = harness.session.submit()
    harness.saves[0]!.reject(new TypeError('Failed to fetch'))
    await submitting

    expect(harness.submits).toHaveLength(0)
    expect(harness.view().status).toBe('answering')
    expect(harness.view().submitFailure?.key).toBe('takeExam.submit.unsavedBlocked')
    expect(harness.view().save.state).toBe('retrying')
    expect(harness.view().answers.get(Q1)).toEqual(B)

    // Once the save gets through, a new submit goes out.
    await advance(2_000)
    harness.saves[1]!.resolve(makeSaveResult())
    await settle()
    const again = harness.session.submit()
    await settle()
    expect(harness.view().submitFailure).toBeNull()
    expect(harness.submits).toHaveLength(1)
    harness.submits[0]!.resolve(makeFinishedAttempt())
    await again
    expect(harness.view().status).toBe('finished')
  })

  it('gives up waiting for a save that does not answer, without submitting', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    const submitting = harness.session.submit()
    await advance(DRAIN_BUDGET_MS)
    await submitting
    expect(harness.submits).toHaveLength(0)
    expect(harness.view().status).toBe('answering')
    expect(harness.view().submitFailure?.key).toBe('takeExam.submit.unsavedBlocked')
  })

  it('reports a submit that failed and lets it be repeated — the answers unlock meanwhile', async () => {
    const harness = await opened()
    const submitting = harness.session.submit()
    await settle()
    harness.submits[0]!.reject(new TypeError('Failed to fetch'))
    await submitting
    expect(harness.view().status).toBe('answering')
    expect(harness.view().submitFailure?.key).toBe('login.errors.network')

    harness.session.answer(Q1, A)
    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    const again = harness.session.submit()
    await settle()
    harness.submits[1]!.resolve(makeFinishedAttempt())
    await again
    expect(harness.view().status).toBe('finished')
    expect(harness.submits).toHaveLength(2)
  })

  it('answers 404 with «not found»', async () => {
    const harness = await opened()
    const submitting = harness.session.submit()
    await settle()
    harness.submits[0]!.reject(refusal(404, 'attempt_not_found'))
    await submitting
    expect(harness.view().status).toBe('not_found')
  })

  it('takes a 400 of the submit for a refused request, not for a missing attempt: the attempt stays open', async () => {
    const harness = await opened()
    const submitting = harness.session.submit()
    await settle()
    // The submit refuses any body field with a 400 (the client sends none): never «not found».
    harness.submits[0]!.reject(refusal(400, undefined, { message: 'property x should not exist' }))
    await submitting
    expect(harness.view().status).toBe('answering')
    expect(harness.view().submitFailure?.key).toBe('login.errors.generic')
  })
})

describe('the end of the time', () => {
  it('locks the answers, flushes what waits, then submits exactly once — the server decides how it counts', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 2 }))
    harness.session.answer(Q1, B)
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[1])) // waits behind the first save
    harness.clock.now += 2_000
    harness.session.timeElapsed()
    harness.session.timeElapsed() // the timer says so on every tick
    expect(harness.view().status).toBe('closing')
    harness.session.answer(Q3, booleanAnswer(true)) // no more changes
    expect(harness.view().answers.get(Q3)).toBeNull()

    harness.saves[0]!.resolve(makeSaveResult({ remainingSeconds: 0 }))
    await settle()
    expect(harness.saves).toHaveLength(2) // the second answer is flushed before the submit
    expect(harness.submits).toHaveLength(0)
    harness.saves[1]!.resolve(makeSaveResult({ remainingSeconds: 0 }))
    await settle()
    expect(harness.submits).toHaveLength(1)

    harness.session.timeElapsed()
    const closed = makeFinishedAttempt({ status: 'submitted' }) // inside the server's allowance: it counts as submitted
    harness.submits[0]!.resolve(closed)
    await settle()
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('clock')
    expect(harness.submits).toHaveLength(1)
  })

  it('does not wait long for a save that hangs: the submit goes out within the server’s allowance', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 1 }))
    harness.session.answer(Q1, B)
    harness.clock.now += 1_000
    harness.session.timeElapsed()
    await advance(FLUSH_BUDGET_MS - 1)
    expect(harness.submits).toHaveLength(0)
    await advance(1)
    expect(harness.submits).toHaveLength(1)

    harness.submits[0]!.resolve(makeFinishedAttempt({ status: 'timed_out', questions: makeMyAttempt().questions }))
    await settle()
    expect(harness.view().status).toBe('finished')
    // Honest about it: the first question's answer never reached the server.
    expect(harness.view().lostAnswers).toEqual([1])
  })

  it('submits at once an attempt that comes back with its time already up', async () => {
    const harness = await opened(makeMyAttempt({ timeUp: true, remainingSeconds: 0 }))
    expect(harness.view().status).toBe('closing')
    expect(harness.submits).toHaveLength(1)
    harness.submits[0]!.resolve(makeFinishedAttempt({ status: 'timed_out' }))
    await settle()
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('clock')
    expect(harness.saves).toHaveLength(0)
  })

  it('reads the attempt again when the submit fails, and waits with «refresh» while the server has not closed it', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 1 }))
    harness.clock.now += 1_000
    harness.session.timeElapsed()
    await settle()
    harness.submits[0]!.reject(new TypeError('Failed to fetch'))
    await settle()
    expect(harness.reads).toHaveLength(2)
    harness.reads[1]!.resolve(makeMyAttempt({ timeUp: true, remainingSeconds: 0 })) // still open on the server
    await settle()
    expect(harness.view().status).toBe('stalled')
    expect(harness.view().endedBy).toBe('clock')
    expect(harness.submits).toHaveLength(1) // once, by itself

    // «Refresh»: still open and over time, so the submit — safe to repeat — closes it.
    const refreshing = harness.session.refresh()
    harness.reads[2]!.resolve(makeMyAttempt({ timeUp: true, remainingSeconds: 0 }))
    await settle()
    expect(harness.submits).toHaveLength(2)
    harness.submits[1]!.resolve(makeFinishedAttempt({ status: 'timed_out' }))
    await refreshing
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('clock')
  })

  it('shows the closed attempt when the re-read after a failed submit finds the server closed it', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 1 }))
    harness.clock.now += 1_000
    harness.session.timeElapsed()
    await settle()
    harness.submits[0]!.reject(refusal(500))
    await settle()
    harness.reads[1]!.resolve(makeFinishedAttempt({ status: 'timed_out' }))
    await settle()
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('clock')
  })

  it('lets a submit that is waiting for its last save go at once when the time runs out', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 5 }))
    harness.session.answer(Q1, B)
    const submitting = harness.session.submit()
    await settle()
    expect(harness.submits).toHaveLength(0)
    harness.clock.now += 5_000
    harness.session.timeElapsed()
    await settle()
    expect(harness.submits).toHaveLength(1) // not after the 15 s it would wait otherwise
    harness.submits[0]!.resolve(makeFinishedAttempt())
    await submitting
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('clock')
  })
})

describe('the page hidden, shown again and left', () => {
  it('sends everything unsaved once more with keepalive when the page is hidden — and does not send twice what that saved', async () => {
    const harness = await opened()
    harness.session.pageHidden()
    expect(harness.saves).toHaveLength(0) // nothing unsaved, nothing sent

    harness.session.answer(Q1, B)
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[0])) // waits behind the first save
    harness.session.pageHidden()
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves[1]!.keepalive).toBe(true)
    expect(harness.saves[1]!.answers).toEqual([
      { examQuestionId: Q1, optionId: OPTION_IDS.first[1] },
      { examQuestionId: Q2, optionId: OPTION_IDS.second[0] },
    ])

    harness.saves[1]!.resolve(makeSaveResult({ saved: 2 }))
    await settle()
    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    expect(harness.view().save.state).toBe('saved')
    expect(harness.saves).toHaveLength(2) // the second question is not sent a second time
  })

  it('flushes the same unsaved answers once when a leaving page reports it twice, and again once they change', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.session.pageHidden() // `visibilitychange`
    harness.session.pageHidden() // `pagehide`, the same instant
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves.map((save) => save.keepalive)).toEqual([false, true])

    harness.session.answer(Q1, C) // the learner is still there and changes the answer
    harness.session.pageHidden()
    expect(harness.saves).toHaveLength(3)
    expect(harness.saves[2]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[2] }])
    // Hidden again later with the same answers still unsaved: one more try.
    harness.clock.now += FLUSH_REPEAT_GAP_MS
    harness.session.pageHidden()
    expect(harness.saves).toHaveLength(4)
    expect(harness.submits).toHaveLength(0) // leaving never submits
  })

  it('reads the attempt again when the page is shown: the server’s time left, and its answers for what is saved here', async () => {
    const harness = await opened(makeMyAttempt({ remainingSeconds: 1800 }))
    harness.session.answer(Q2, choiceAnswer(OPTION_IDS.second[2])) // on its way when the page comes back
    harness.clock.now += 60_000 // a minute in the background by the device's count…
    harness.session.pageVisible()
    expect(harness.reads).toHaveLength(2)
    // …but the server says ten minutes passed (the device slept), and another tab answered the first question.
    harness.reads[1]!.resolve(makeMyAttempt({ questions: makeAnsweredQuestions(), remainingSeconds: 1200 }))
    await settle()

    const view = harness.view()
    expect(secondsLeft(view.clock!, harness.clock.now)).toBe(1200)
    expect(view.answers.get(Q1)).toEqual(B) // the other tab's, taken
    expect(view.answers.get(Q2)).toEqual(choiceAnswer(OPTION_IDS.second[2])) // this page's unsaved change, kept
    expect(view.status).toBe('answering')
  })

  it('leaves the answers alone when a change crossed the read', async () => {
    const harness = await opened()
    harness.session.pageVisible()
    harness.session.answer(Q1, C) // chosen while the read is on its way
    harness.saves[0]!.resolve(makeSaveResult())
    await settle()
    harness.reads[1]!.resolve(makeMyAttempt({ remainingSeconds: 1790 })) // read before the save: no answer for the first question
    await settle()
    expect(harness.view().answers.get(Q1)).toEqual(C)
    expect(harness.view().save.state).toBe('saved')
  })

  it('finds the attempt closed elsewhere when it comes back', async () => {
    const harness = await opened()
    harness.session.pageVisible()
    harness.reads[1]!.resolve(makeFinishedAttempt())
    await settle()
    expect(harness.view().status).toBe('finished')
    expect(harness.view().endedBy).toBe('elsewhere')
  })

  it('asks the server again when the device’s clocks disagree — not more often than every five seconds', async () => {
    const harness = await opened()
    harness.session.resync()
    harness.session.resync()
    expect(harness.reads).toHaveLength(2)
    harness.reads[1]!.resolve(makeMyAttempt({ remainingSeconds: 900 }))
    await settle()
    expect(harness.view().clock?.remainingSeconds).toBe(900)

    harness.clock.now += RESYNC_MIN_GAP_MS - 1
    harness.session.resync()
    expect(harness.reads).toHaveLength(2)
    harness.clock.now += 1
    harness.session.resync()
    expect(harness.reads).toHaveLength(3)
  })

  it('flushes with keepalive when the page leaves, then shows nothing more; coming back picks the attempt up', async () => {
    const harness = await opened()
    harness.session.answer(Q1, B)
    harness.session.stop()
    expect(harness.saves).toHaveLength(2)
    expect(harness.saves[1]!.keepalive).toBe(true)
    expect(harness.saves[1]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])

    const before = harness.view()
    harness.saves[0]!.reject(refusal(409, 'attempt_closed', { status: 'timed_out' })) // answered to a page that left
    harness.saves[1]!.resolve(makeSaveResult())
    await settle()
    expect(harness.view()).toBe(before)
    expect(harness.reads).toHaveLength(1)

    harness.session.start()
    expect(harness.reads).toHaveLength(2) // the time left is asked again
    expect(harness.saves).toHaveLength(3) // and the answer that got no reply is sent again
    expect(harness.saves[2]!.answers).toEqual([{ examQuestionId: Q1, optionId: OPTION_IDS.first[1] }])
  })
})
