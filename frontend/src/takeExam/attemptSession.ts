// One sitting of an attempt at an online exam (MOD-09 phase 2 — API-277,
// API-278, API-279): the state behind /take-exam/:attemptId, kept outside
// React so that its requests, timers and answers never depend on a render.
// The page subscribes to its snapshot (useAttemptSession.ts).
//
// What it guarantees:
//
// - **The time is the server's.** Every answer about the attempt hands its
//   `remainingSeconds` to syncClock() with the monotonic moments of its round
//   trip (takeExam.clock.ts). Nothing here reads the device's date.
// - **Nothing about correctness.** It reads the learner's own attempt
//   (API-277) and nothing else — never a teacher route — and keeps what the
//   server sent as it is: `result` and `review` are shown only when present.
// - **Answers are not lost quietly.** A chosen answer is on screen at once and
//   in the queue (takeExam.queue.ts); one request at a time carries what is
//   queued; a failed request keeps its answers and is tried again after a
//   growing pause (a 429 after the wait it names); the page is told while
//   anything is unsaved; when the page is hidden or left, what is unsaved goes
//   out once more with `keepalive`; and an attempt that closes over unsaved
//   answers names them (`lostAnswers`).
// - **One final submit.** A manual submit locks the answers, waits for the
//   queue to drain — and says so instead of submitting when it cannot — then
//   calls API-279 once. When the time runs out the answers are locked, the
//   queue is flushed for a moment (the server takes a write up to 5 s after the
//   deadline) and API-279 is called once: the server decides whether that
//   counts as submitted or as closed at the deadline. If that request fails the
//   attempt is read again; the server closes an overdue attempt by itself
//   within about a minute, so the page then waits with «refresh» (`stalled`).
// - 409 `attempt_closed` on a save stops the saving for good and reads the
//   attempt again; 400 `answers_invalid` drops what was queued and takes the
//   server's answers.
import { apiRequest } from '../api/client'
import { getMyAttempt, myAttemptPath, saveMyAnswers, submitMyAttempt } from '../api/myAttempts'
import type { AnswerEntry, MyAttempt, SaveAnswersResult } from '../api/myAttempts'
import { answersOf, reconcileAnswers, unsavedNumbers } from './takeExam.answers'
import type { AnswerMap, LocalAnswer } from './takeExam.answers'
import { isTimeOver, monotonicNow, syncClock } from './takeExam.clock'
import type { ClockSync } from './takeExam.clock'
import { describeSaveFailure, describeTakeFailure, isAttemptGone, isUnknownAttemptId } from './takeExam.errors'
import type { TakeFailure } from './takeExam.errors'
import { acknowledge, beginSave, changeAnswer, closeQueue, emptyQueue, entriesOf, hasUnsaved, requeueInFlight, retryDelayMs, saveFailed, saveSucceeded, unsavedOf } from './takeExam.queue'
import type { SaveQueue } from './takeExam.queue'

/** A save that got no answer in this long is given up and tried again (it would hold the queue for good otherwise). */
export const SAVE_TIMEOUT_MS = 20_000
/** A submit that got no answer in this long is reported as failed (repeating it is safe). */
export const SUBMIT_TIMEOUT_MS = 30_000
/** How long a manual submit waits for the unsaved answers before it says it cannot submit. */
export const DRAIN_BUDGET_MS = 15_000
/** How long the end of the time waits for the last save: the server takes a write up to 5 s after the deadline. */
export const FLUSH_BUDGET_MS = 3_000
/** Re-reads asked by the clock (not by the learner coming back) keep at least this far apart. */
export const RESYNC_MIN_GAP_MS = 5_000
/** The same unsaved answers are not flushed with keepalive twice within this long. */
export const FLUSH_REPEAT_GAP_MS = 1_000

export type SessionStatus =
  /** The attempt is being read for the first time (or again after a failed read). */
  | 'loading'
  /** The read failed for a reason a retry may fix. */
  | 'failed'
  /** 404: not this learner's attempt, or gone. */
  | 'not_found'
  /** In progress, with time left: answers are taken. */
  | 'answering'
  /** The learner confirmed the submit: answers are locked while the queue drains and API-279 runs. */
  | 'submitting'
  /** The time is over: answers are locked while the last save and the one submit run. */
  | 'closing'
  /** The attempt has ended but its closed state could not be read: «refresh». */
  | 'stalled'
  /** `submitted` or `timed_out`: the result and the review, when the server sent them. */
  | 'finished'

/** Why the attempt ended while this page was open; null for an attempt opened already finished. */
export type EndedBy = 'self' | 'clock' | 'elsewhere'

/** What the «saved» line of the page says. */
export type SaveState =
  /** Every answer on screen reached the server. */
  | 'saved'
  /** A request is on its way (or about to leave). */
  | 'saving'
  /** The last save failed; the next try is scheduled. */
  | 'retrying'
  /** The last save was refused in a way a retry by itself would not fix. */
  | 'held'

export interface SaveView {
  state: SaveState
  failure: TakeFailure | null
  /** True while any answer on screen has not reached the server. */
  unsaved: boolean
}

export interface SessionSnapshot {
  status: SessionStatus
  /** The server's last full answer about the attempt. */
  attempt: MyAttempt | null
  /** The answers on screen. */
  answers: AnswerMap
  /** The running clock, while the attempt is in progress. */
  clock: ClockSync | null
  save: SaveView
  loadFailure: TakeFailure | null
  /** Why the last manual submit did not happen (unsaved answers, a failed request). */
  submitFailure: TakeFailure | null
  endedBy: EndedBy | null
  /** 400 answers_invalid: what was queued was dropped and the server's answers are on screen. */
  answersReset: boolean
  /** Positions (1-based) of the answers that had not reached the server when the attempt closed. */
  lostAnswers: readonly number[]
  /** A «refresh» of the stalled state is running. */
  refreshing: boolean
}

type TimerHandle = ReturnType<typeof setTimeout>

export interface SessionDeps {
  getAttempt: (attemptId: string, signal?: AbortSignal) => Promise<MyAttempt>
  saveAnswers: (attemptId: string, answers: AnswerEntry[], options: { signal?: AbortSignal; keepalive?: boolean }) => Promise<SaveAnswersResult>
  submitAttempt: (attemptId: string) => Promise<MyAttempt>
  /** The monotonic clock (ms). */
  now: () => number
  setTimer: (run: () => void, ms: number) => TimerHandle
  clearTimer: (handle: TimerHandle) => void
}

/**
 * API-278. api/myAttempts.ts's saveMyAnswers() takes no `keepalive`, so the save that must outlive a closing tab is
 * the same request sent through apiRequest() (a body of at most 200 small entries — far below the 64 KB a
 * keepalive request may carry).
 */
function putAnswers(attemptId: string, answers: AnswerEntry[], options: { signal?: AbortSignal; keepalive?: boolean }): Promise<SaveAnswersResult> {
  if (!options.keepalive) return saveMyAnswers(attemptId, answers, options.signal)
  return apiRequest<SaveAnswersResult>(`${myAttemptPath(attemptId)}/answers`, { method: 'PUT', body: { answers }, keepalive: true })
}

const DEFAULT_DEPS: SessionDeps = {
  getAttempt: getMyAttempt,
  saveAnswers: putAnswers,
  submitAttempt: submitMyAttempt,
  now: monotonicNow,
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle),
}

const NO_ANSWERS: AnswerMap = new Map()
const SAVED: SaveView = { state: 'saved', failure: null, unsaved: false }

const INITIAL: SessionSnapshot = {
  status: 'loading',
  attempt: null,
  answers: NO_ANSWERS,
  clock: null,
  save: SAVED,
  loadFailure: null,
  submitFailure: null,
  endedBy: null,
  answersReset: false,
  lostAnswers: [],
  refreshing: false,
}

/** The statuses in which the attempt is open on this page. */
function isLive(status: SessionStatus): boolean {
  return status === 'answering' || status === 'submitting' || status === 'closing'
}

interface RereadRequest {
  /** Why the attempt ended, if the read finds it finished. */
  whenFinished: EndedBy
  /** Take the server's answers even when a change crossed the read (after `answers_invalid`). */
  adoptAnswers: boolean
  /** The read MUST learn the closed state (after `attempt_closed`): a failure leaves the page waiting with «refresh». */
  mustClose: boolean
}

export interface AttemptSession {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => SessionSnapshot
  /** The page is on screen: reads the attempt (again, after a stop). */
  start: () => void
  /** The page left: nothing is shown any more; what is unsaved goes out once with `keepalive`. */
  stop: () => void
  /** «Retry» of a failed read. */
  reload: () => void
  /** The learner chose, changed or cleared (null) the answer of a question. */
  answer: (questionId: string, answer: LocalAnswer) => void
  /** «Retry» of a failed save — and the network coming back. */
  retrySave: () => void
  /** The confirmed final submit. */
  submit: () => Promise<void>
  /** The timer reached zero. */
  timeElapsed: () => void
  /** The device's clocks disagree: ask the server for the time left. */
  resync: () => void
  /** «Refresh» of the stalled state. */
  refresh: () => Promise<void>
  /** The tab was hidden (or the page is being left): flush with `keepalive`. */
  pageHidden: () => void
  /** The tab is visible again: read the attempt for the time left (timers are throttled in the background). */
  pageVisible: () => void
  dismissAnswersReset: () => void
}

export function createAttemptSession(attemptId: string, overrides: Partial<SessionDeps> = {}): AttemptSession {
  const deps: SessionDeps = { ...DEFAULT_DEPS, ...overrides }
  const listeners = new Set<() => void>()
  let snapshot = INITIAL
  let queue: SaveQueue = emptyQueue()
  let saveFailure: TakeFailure | null = null
  let retryTimer: TimerHandle | null = null
  /** Between start() and stop(). */
  let running = false
  /** Bumped by stop(): the answer of a request sent before it is dropped. */
  let generation = 0
  /** Bumped by every local change and every save that succeeded: a read that crossed one does not touch the answers. */
  let changes = 0
  let readController: AbortController | null = null
  let rereading = false
  /** A read asked while another was on its way: it runs next. */
  let rereadNext: RereadRequest | null = null
  let lastResyncAt = Number.NEGATIVE_INFINITY
  /** The end of the time is handled once. */
  let closingStarted = false
  /** The answers that had not reached the server when it refused them with `attempt_closed`. */
  let refusedUnsaved: AnswerMap | null = null
  /** The last flush with keepalive: which state of the answers it carried, and when. */
  let flushed: { changes: number; at: number } | null = null
  let idleWaiters: ((drained: boolean) => void)[] = []

  /** The status NOW — asked after every `await`, when it may be another than before it. */
  const statusIs = (status: SessionStatus): boolean => snapshot.status === status

  const saveView = (): SaveView => {
    if (!hasUnsaved(queue)) return SAVED
    if (saveFailure === null) return { state: 'saving', failure: null, unsaved: true }
    return { state: retryTimer !== null ? 'retrying' : queue.inFlight !== null ? 'saving' : 'held', failure: saveFailure, unsaved: true }
  }

  const set = (patch: Partial<SessionSnapshot> = {}) => {
    snapshot = { ...snapshot, ...patch, save: saveView() }
    for (const listener of [...listeners]) listener()
  }

  const cancelRetry = () => {
    if (retryTimer !== null) deps.clearTimer(retryTimer)
    retryTimer = null
  }

  const resolveIdle = (drained: boolean) => {
    const waiters = idleWaiters
    idleWaiters = []
    for (const waiter of waiters) waiter(drained)
  }

  /** Resolves true once nothing is unsaved; false when a save fails, the wait is cut short or `budgetMs` passes. */
  const whenIdle = (budgetMs: number): Promise<boolean> => {
    if (!hasUnsaved(queue)) return Promise.resolve(true)
    return new Promise((resolve) => {
      const waiter = (drained: boolean) => {
        deps.clearTimer(timer)
        resolve(drained)
      }
      const timer = deps.setTimer(() => {
        idleWaiters = idleWaiters.filter((entry) => entry !== waiter)
        resolve(false)
      }, budgetMs)
      idleWaiters.push(waiter)
    })
  }

  const timeOver = () => snapshot.clock !== null && isTimeOver(snapshot.clock, deps.now())

  /** The attempt is finished on the server: its result and review are whatever it sent. */
  const finish = (attempt: MyAttempt, endedBy: EndedBy | null) => {
    // Said honestly: the answers that never reached the server and are not what it holds.
    const lostAnswers = unsavedNumbers(attempt.questions, refusedUnsaved ?? unsavedOf(queue))
    queue = closeQueue(queue)
    refusedUnsaved = null
    saveFailure = null
    cancelRetry()
    resolveIdle(false)
    set({ status: 'finished', attempt, answers: answersOf(attempt.questions), clock: null, endedBy, lostAnswers, submitFailure: null, loadFailure: null, refreshing: false })
  }

  /** The attempt has ended, but its closed state is not known yet: the page waits with «refresh». */
  const stall = (endedBy: EndedBy) => {
    cancelRetry()
    resolveIdle(false)
    set({ status: 'stalled', endedBy, refreshing: false })
  }

  /** An answer about an attempt still in progress: the clock always, the answers when the read crossed no change. */
  const applyLive = (attempt: MyAttempt, sentAt: number, adoptAnswers: boolean) => {
    const clock = syncClock(snapshot.clock, { remainingSeconds: attempt.remainingSeconds, sentAt, receivedAt: deps.now() })
    const answers = adoptAnswers ? reconcileAnswers(attempt.questions, unsavedOf(queue)) : snapshot.answers
    set({ attempt, clock, answers, status: isLive(snapshot.status) ? snapshot.status : 'answering', loadFailure: null, refreshing: false })
    if (attempt.timeUp || attempt.remainingSeconds <= 0) void close()
  }

  const load = async () => {
    const mine = generation
    readController?.abort()
    const controller = new AbortController()
    readController = controller
    set({ status: 'loading', loadFailure: null })
    const sentAt = deps.now()
    try {
      const attempt = await deps.getAttempt(attemptId, controller.signal)
      if (mine !== generation || controller.signal.aborted) return
      if (attempt.status === 'in_progress') applyLive(attempt, sentAt, true)
      else finish(attempt, null)
    } catch (error) {
      if (mine !== generation || controller.signal.aborted) return
      // Not this learner's attempt — or an id no attempt can have (a mistyped link), which only this first read can meet.
      if (isAttemptGone(error) || isUnknownAttemptId(error)) set({ status: 'not_found' })
      else set({ status: 'failed', loadFailure: describeTakeFailure(error) })
    }
  }

  /** Reads the attempt again while it is open on this page; one read at a time — a read asked meanwhile runs next. */
  const reread = async (request: RereadRequest): Promise<void> => {
    if (rereading) {
      rereadNext = request
      return
    }
    rereading = true
    const mine = generation
    const seen = changes
    const sentAt = deps.now()
    try {
      const attempt = await deps.getAttempt(attemptId)
      if (mine !== generation || !isLive(snapshot.status)) return
      if (attempt.status !== 'in_progress') finish(attempt, request.whenFinished)
      // The server refused a save as closed, yet this read (sent before) still shows it open: the next read knows.
      else if (queue.closed) {
        if (rereadNext === null) stall(request.whenFinished)
      } else applyLive(attempt, sentAt, request.adoptAnswers || seen === changes)
    } catch (error) {
      if (mine !== generation || !isLive(snapshot.status)) return
      if (isAttemptGone(error)) set({ status: 'not_found' })
      else if ((request.mustClose || queue.closed) && rereadNext === null) stall(request.whenFinished)
      // Else nothing changes: the clock keeps running on its last answer.
    } finally {
      rereading = false
      const next = rereadNext
      rereadNext = null
      if (next !== null && mine === generation && isLive(snapshot.status)) void reread(next)
    }
  }

  const send = async (batch: AnswerMap) => {
    const mine = generation
    const controller = new AbortController()
    const timeout = deps.setTimer(() => controller.abort(), SAVE_TIMEOUT_MS)
    const sentAt = deps.now()
    let result: SaveAnswersResult
    try {
      result = await deps.saveAnswers(attemptId, entriesOf(batch), { signal: controller.signal })
    } catch (error) {
      deps.clearTimer(timeout)
      // Answered to a page that left, or to an attempt that has ended meanwhile: nothing to do with it.
      if (mine === generation && isLive(snapshot.status)) await saveRefused(error)
      return
    }
    deps.clearTimer(timeout)
    if (mine !== generation || !isLive(snapshot.status)) return
    queue = saveSucceeded(queue)
    saveFailure = null
    changes += 1
    set({ clock: snapshot.clock ? syncClock(snapshot.clock, { remainingSeconds: result.remainingSeconds, sentAt, receivedAt: deps.now() }) : snapshot.clock })
    pump()
  }

  /** A save was refused or got no answer: what the page does next (describeSaveFailure). */
  const saveRefused = async (error: unknown) => {
    const failure = describeSaveFailure(error)
    if (failure.next === 'closed') {
      // The time was over or it was submitted elsewhere: what was saved before is what counts.
      refusedUnsaved = unsavedOf(queue)
      queue = closeQueue(queue)
      saveFailure = null
      cancelRetry()
      resolveIdle(false)
      set()
      await reread({ whenFinished: statusIs('closing') ? 'clock' : 'elsewhere', adoptAnswers: false, mustClose: true })
      return
    }
    if (failure.next === 'reset') {
      // The screen and the server disagree about the questions: start again from the server's answers.
      queue = emptyQueue()
      saveFailure = null
      cancelRetry()
      resolveIdle(false)
      set({ answersReset: true })
      await reread({ whenFinished: 'elsewhere', adoptAnswers: true, mustClose: false })
      return
    }
    if (failure.next === 'gone') {
      cancelRetry()
      resolveIdle(false)
      set({ status: 'not_found' })
      return
    }
    queue = saveFailed(queue)
    saveFailure = failure
    // Once the time is over there is no later try worth waiting for.
    if (failure.next === 'retry' && !statusIs('closing')) {
      cancelRetry()
      retryTimer = deps.setTimer(() => {
        retryTimer = null
        pump()
      }, retryDelayMs(queue.failures, failure.retryAfterSeconds ?? null))
    }
    set()
    resolveIdle(false)
  }

  /** Sends what waits, unless a request is on its way or a retry is scheduled. */
  function pump() {
    if (!running || retryTimer !== null || !isLive(snapshot.status)) return
    const taken = beginSave(queue)
    if (taken.batch === null) {
      if (!hasUnsaved(queue)) resolveIdle(true)
      return
    }
    queue = taken.queue
    set()
    void send(taken.batch)
  }

  const pumpNow = () => {
    cancelRetry()
    pump()
  }

  /** One more request with everything unsaved, sent so that it outlives the page; the queue itself is left as it is. */
  const flushWithKeepalive = () => {
    if (!running || !isLive(snapshot.status)) return
    const unsaved = unsavedOf(queue)
    if (unsaved.size === 0) return
    // A page that is left reports it twice (`visibilitychange`, then `pagehide`): the same answers go out once.
    if (flushed !== null && flushed.changes === changes && deps.now() - flushed.at < FLUSH_REPEAT_GAP_MS) return
    flushed = { changes, at: deps.now() }
    const mine = generation
    const sentAt = deps.now()
    deps.saveAnswers(attemptId, entriesOf(unsaved), { keepalive: true }).then(
      (result) => {
        if (mine !== generation || !isLive(snapshot.status)) return
        queue = acknowledge(queue, unsaved)
        changes += 1
        if (!hasUnsaved(queue)) {
          saveFailure = null
          cancelRetry()
        }
        set({ clock: snapshot.clock ? syncClock(snapshot.clock, { remainingSeconds: result.remainingSeconds, sentAt, receivedAt: deps.now() }) : snapshot.clock })
        if (!hasUnsaved(queue)) resolveIdle(true)
      },
      () => {
        // The regular queue still holds these answers: its own request reports what went wrong.
      },
    )
  }

  /** Calls API-279 once; a request without an answer is given up after SUBMIT_TIMEOUT_MS (repeating it is safe). */
  const submitOnce = (): Promise<MyAttempt> =>
    new Promise((resolve, reject) => {
      const timer = deps.setTimer(() => reject(new Error('The submit got no answer in time')), SUBMIT_TIMEOUT_MS)
      deps.submitAttempt(attemptId).then(
        (attempt) => {
          deps.clearTimer(timer)
          resolve(attempt)
        },
        (error: unknown) => {
          deps.clearTimer(timer)
          reject(error instanceof Error ? error : new Error('The submit failed'))
        },
      )
    })

  /** The submit at the end of the time failed: learn the closed state, or wait with «refresh». */
  const afterFailedClose = async (error: unknown, mine: number) => {
    if (isAttemptGone(error)) {
      set({ status: 'not_found' })
      return
    }
    try {
      const attempt = await deps.getAttempt(attemptId)
      if (mine !== generation || !statusIs('closing')) return
      if (attempt.status !== 'in_progress') finish(attempt, 'clock')
      else stall('clock')
    } catch (rereadError) {
      if (mine !== generation || !statusIs('closing')) return
      if (isAttemptGone(rereadError)) set({ status: 'not_found' })
      else stall('clock')
    }
  }

  /** The time is over: lock the answers, flush the queue for a moment, submit once. */
  async function close() {
    if (closingStarted || !statusIs('answering')) return
    closingStarted = true
    const mine = generation
    set({ status: 'closing', submitFailure: null })
    pumpNow()
    await whenIdle(FLUSH_BUDGET_MS)
    if (mine !== generation || !statusIs('closing')) return
    try {
      const attempt = await submitOnce()
      if (mine !== generation || !statusIs('closing')) return
      if (attempt.status === 'in_progress') stall('clock')
      else finish(attempt, 'clock')
    } catch (error) {
      if (mine !== generation || !statusIs('closing')) return
      await afterFailedClose(error, mine)
    }
  }

  const submit = async () => {
    if (!statusIs('answering')) return
    const mine = generation
    set({ status: 'submitting', submitFailure: null })
    pumpNow()
    const drained = await whenIdle(DRAIN_BUDGET_MS)
    if (mine !== generation || !statusIs('submitting')) return
    const byClock = timeOver()
    if (!drained && !byClock) {
      // Never a silent submit over unsaved answers: say so and let the learner decide again.
      set({ status: 'answering', submitFailure: { key: 'takeExam.submit.unsavedBlocked', code: null, terminal: false } })
      return
    }
    try {
      const attempt = await submitOnce()
      if (mine !== generation || !statusIs('submitting')) return
      if (attempt.status === 'in_progress') set({ status: 'answering', submitFailure: { key: 'takeExam.submit.failed', code: null, terminal: false } })
      else finish(attempt, byClock ? 'clock' : 'self')
    } catch (error) {
      if (mine !== generation || !statusIs('submitting')) return
      if (isAttemptGone(error)) {
        set({ status: 'not_found' })
        return
      }
      if (timeOver()) {
        // The time ran out while the submit was failing: the end of the time takes over.
        closingStarted = true
        set({ status: 'closing' })
        await afterFailedClose(error, mine)
        return
      }
      set({ status: 'answering', submitFailure: describeTakeFailure(error) })
    }
  }

  const refresh = async () => {
    if (!statusIs('stalled') || snapshot.refreshing) return
    const mine = generation
    const endedBy = snapshot.endedBy ?? 'clock'
    set({ refreshing: true })
    const sentAt = deps.now()
    try {
      let attempt = await deps.getAttempt(attemptId)
      // Still open on the server although its time is over: the submit closes it (and is safe to repeat).
      if (attempt.status === 'in_progress' && attempt.timeUp) attempt = await submitOnce()
      if (mine !== generation || !statusIs('stalled')) return
      if (attempt.status !== 'in_progress') {
        finish(attempt, endedBy)
        return
      }
      // The server says the attempt is open and has time left: go on answering from its answers.
      queue = emptyQueue()
      refusedUnsaved = null
      saveFailure = null
      closingStarted = false
      set({ status: 'answering', endedBy: null })
      applyLive(attempt, sentAt, true)
    } catch (error) {
      if (mine !== generation || !statusIs('stalled')) return
      if (isAttemptGone(error)) set({ status: 'not_found', refreshing: false })
      else set({ refreshing: false })
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    start: () => {
      if (running) return
      running = true
      if (snapshot.attempt === null || statusIs('failed')) void load()
      else if (isLive(snapshot.status)) {
        pump()
        void reread({ whenFinished: 'elsewhere', adoptAnswers: false, mustClose: false })
      }
    },
    stop: () => {
      if (!running) return
      flushWithKeepalive()
      running = false
      generation += 1
      readController?.abort()
      readController = null
      rereading = false
      rereadNext = null
      cancelRetry()
      resolveIdle(false)
      // A request on its way will not be answered to this page any more: its answers wait again.
      queue = requeueInFlight(queue)
    },
    reload: () => {
      if (running && (statusIs('failed') || statusIs('loading'))) void load()
    },
    answer: (questionId, answer) => {
      if (!statusIs('answering')) return
      const answers = new Map(snapshot.answers)
      answers.set(questionId, answer)
      queue = changeAnswer(queue, questionId, answer)
      changes += 1
      set({ answers })
      pump()
    },
    retrySave: () => {
      if (isLive(snapshot.status) && hasUnsaved(queue)) pumpNow()
    },
    submit,
    timeElapsed: () => {
      if (statusIs('answering')) void close()
      // A manual submit is waiting for its last save: the time is over, so it goes now and the server decides.
      else if (statusIs('submitting')) resolveIdle(false)
    },
    resync: () => {
      if (!statusIs('answering') || deps.now() - lastResyncAt < RESYNC_MIN_GAP_MS) return
      lastResyncAt = deps.now()
      void reread({ whenFinished: 'elsewhere', adoptAnswers: false, mustClose: false })
    },
    refresh,
    pageHidden: flushWithKeepalive,
    pageVisible: () => {
      if (!running || (!statusIs('answering') && !statusIs('submitting'))) return
      if (saveFailure !== null) pumpNow()
      // A submit on its way will answer by itself; reading across it could report the end as somebody else's.
      if (!statusIs('answering')) return
      lastResyncAt = deps.now()
      void reread({ whenFinished: 'elsewhere', adoptAnswers: false, mustClose: false })
    },
    dismissAnswersReset: () => {
      if (snapshot.answersReset) set({ answersReset: false })
    },
  }
}
