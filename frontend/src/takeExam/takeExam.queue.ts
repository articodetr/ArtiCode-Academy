// The save queue of an attempt (MOD-09 phase 2 — API-278): pure state and
// its transitions, unit-tested in takeExam.queue.test.ts.
//
// Answers save themselves. Choosing an answer puts that question in `pending`
// with its whole new answer; ONE request at a time carries what is pending
// (`inFlight`). A change made while a request is on its way waits in `pending`
// and goes with the next request — several quick changes of one question are
// one entry, the last one. A failed request gives its answers back, unless the
// learner has changed them again meanwhile (the newer answer stays). Every
// entry is the whole answer of its question, so sending one twice is harmless.
//
// Once the attempt takes no more answers (409 `attempt_closed`, the submit,
// the end of the time) the queue is closed: nothing is queued or sent again.
//
// No React, no timers and no requests here — attemptSession.ts drives it.
import { ANSWERS_BATCH_MAX } from '../api/myAttempts'
import type { AnswerEntry } from '../api/myAttempts'
import { entryOf, sameAnswer } from './takeExam.answers'
import type { AnswerMap, LocalAnswer } from './takeExam.answers'

export interface SaveQueue {
  /** Changed on screen and not sent yet: question id → its whole new answer, in the order of the first change. */
  pending: AnswerMap
  /** The answers the request on its way carries, or null when none is. */
  inFlight: AnswerMap | null
  /** Failed requests in a row (0 again after a success): the pause before the next try grows with it. */
  failures: number
  /** The attempt takes no more answers. */
  closed: boolean
}

const NOTHING: AnswerMap = new Map()

export function emptyQueue(): SaveQueue {
  return { pending: NOTHING, inFlight: null, failures: 0, closed: false }
}

/** The learner chose, changed or cleared the answer of one question. */
export function changeAnswer(queue: SaveQueue, questionId: string, answer: LocalAnswer): SaveQueue {
  if (queue.closed) return queue
  const pending = new Map(queue.pending)
  pending.set(questionId, answer)
  return { ...queue, pending }
}

/** True when a request may leave now: something waits, none is on its way and the attempt is open. */
export function canSend(queue: SaveQueue): boolean {
  return !queue.closed && queue.inFlight === null && queue.pending.size > 0
}

/** Starts a request: up to `max` waiting answers become the batch on its way. `batch` is null when none may leave. */
export function beginSave(queue: SaveQueue, max: number = ANSWERS_BATCH_MAX): { queue: SaveQueue; batch: AnswerMap | null } {
  if (!canSend(queue)) return { queue, batch: null }
  const entries = [...queue.pending]
  const batch = new Map(entries.slice(0, max))
  return { queue: { ...queue, pending: new Map(entries.slice(max)), inFlight: batch }, batch }
}

/** The request on its way was answered 200: its answers are saved. */
export function saveSucceeded(queue: SaveQueue): SaveQueue {
  return { ...queue, inFlight: null, failures: 0 }
}

/** The request on its way failed: its answers wait again — first in line — except those changed again meanwhile. */
export function saveFailed(queue: SaveQueue): SaveQueue {
  if (queue.inFlight === null) return queue
  const pending = new Map(queue.inFlight)
  // A question changed while the request was on its way keeps its place in line with the newer answer.
  for (const [questionId, answer] of queue.pending) pending.set(questionId, answer)
  return { ...queue, pending, inFlight: null, failures: queue.failures + 1 }
}

/** The request on its way will never be answered to this page (it left): its answers wait again, and no failure is counted. */
export function requeueInFlight(queue: SaveQueue): SaveQueue {
  if (queue.inFlight === null) return queue
  return { ...saveFailed(queue), failures: queue.failures }
}

/**
 * Answers that reached the server by another request (the one sent with `keepalive` as the page was hidden): those
 * still waiting with the very same answer need not be sent again. The batch on its way is left to its own answer.
 */
export function acknowledge(queue: SaveQueue, saved: AnswerMap): SaveQueue {
  let changed = false
  const pending = new Map(queue.pending)
  for (const [questionId, answer] of saved) {
    if (pending.has(questionId) && sameAnswer(pending.get(questionId), answer)) {
      pending.delete(questionId)
      changed = true
    }
  }
  return changed ? { ...queue, pending } : queue
}

/** The attempt takes no more answers: whatever waited is dropped and nothing is queued again. */
export function closeQueue(queue: SaveQueue): SaveQueue {
  return { pending: NOTHING, inFlight: null, failures: queue.failures, closed: true }
}

/** Every answer the server may not hold yet: the batch on its way, then what waits (the newer answer of a question wins). */
export function unsavedOf(queue: SaveQueue): AnswerMap {
  if (queue.inFlight === null) return queue.pending
  const unsaved = new Map(queue.inFlight)
  for (const [questionId, answer] of queue.pending) unsaved.set(questionId, answer)
  return unsaved
}

export function hasUnsaved(queue: SaveQueue): boolean {
  return queue.inFlight !== null || queue.pending.size > 0
}

/** A batch as the body of API-278 — at most ANSWERS_BATCH_MAX entries, no question twice. */
export function entriesOf(batch: AnswerMap): AnswerEntry[] {
  return [...batch].slice(0, ANSWERS_BATCH_MAX).map(([questionId, answer]) => entryOf(questionId, answer))
}

/** The growing pause before a failed save is tried again by itself. */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const
/** A 429's wait is honoured within these bounds. */
const RETRY_AFTER_MIN_MS = 1_000
const RETRY_AFTER_MAX_MS = 60_000

/**
 * How long to wait before the next try: what the server asked (a 429's `Retry-After`, within 1–60 s), else a pause
 * that grows with the failures in a row — 2, 4, 8, 15, then 30 seconds.
 */
export function retryDelayMs(failures: number, retryAfterSeconds: number | null = null): number {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(RETRY_AFTER_MAX_MS, Math.max(RETRY_AFTER_MIN_MS, Math.ceil(retryAfterSeconds * 1000)))
  }
  const index = Math.min(RETRY_DELAYS_MS.length - 1, Math.max(0, Math.floor(failures) - 1))
  return RETRY_DELAYS_MS[index]!
}
