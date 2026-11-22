// MOD-09 phase 2 (OEX-T07) — the save queue of an attempt: one request at a
// time, quick changes coalesced, a failed request keeps its answers, and
// nothing is queued once the attempt is closed.
import { describe, expect, it } from 'vitest'
import { ANSWERS_BATCH_MAX } from '../api/myAttempts'
import { booleanAnswer, choiceAnswer } from './takeExam.answers'
import {
  RETRY_DELAYS_MS,
  acknowledge,
  beginSave,
  canSend,
  changeAnswer,
  closeQueue,
  emptyQueue,
  entriesOf,
  hasUnsaved,
  requeueInFlight,
  retryDelayMs,
  saveFailed,
  saveSucceeded,
  unsavedOf,
} from './takeExam.queue'
import type { SaveQueue } from './takeExam.queue'

const A = choiceAnswer('option-a')
const B = choiceAnswer('option-b')
const C = choiceAnswer('option-c')

/** Starts a request and returns the queue with the batch on its way. */
function begin(queue: SaveQueue) {
  const taken = beginSave(queue)
  if (taken.batch === null) throw new Error('nothing could be sent')
  return { queue: taken.queue, batch: taken.batch }
}

describe('the save queue', () => {
  it('queues a chosen answer, sends it in one request and is empty again once the server answered', () => {
    const empty = emptyQueue()
    expect(hasUnsaved(empty)).toBe(false)
    expect(canSend(empty)).toBe(false)
    expect(beginSave(empty).batch).toBeNull()

    const queued = changeAnswer(empty, 'q1', A)
    expect(hasUnsaved(queued)).toBe(true)
    expect(canSend(queued)).toBe(true)

    const { queue: sending, batch } = begin(queued)
    expect([...batch]).toEqual([['q1', A]])
    expect(sending.pending.size).toBe(0)
    expect(hasUnsaved(sending)).toBe(true) // on its way is not saved yet

    const saved = saveSucceeded(sending)
    expect(hasUnsaved(saved)).toBe(false)
    expect(saved.inFlight).toBeNull()
  })

  it('coalesces quick changes: several changes of one question are one entry — the last one', () => {
    let queue = emptyQueue()
    queue = changeAnswer(queue, 'q1', A)
    queue = changeAnswer(queue, 'q1', B)
    queue = changeAnswer(queue, 'q2', booleanAnswer(true))
    queue = changeAnswer(queue, 'q1', C)
    const { batch } = begin(queue)
    expect([...batch]).toEqual([
      ['q1', C],
      ['q2', booleanAnswer(true)],
    ])
    expect(entriesOf(batch)).toEqual([
      { examQuestionId: 'q1', optionId: 'option-c' },
      { examQuestionId: 'q2', value: true },
    ])
  })

  it('keeps ONE request on its way: changes made meanwhile wait and go together with the next', () => {
    let { queue } = begin(changeAnswer(emptyQueue(), 'q1', A))
    queue = changeAnswer(queue, 'q1', B) // the same question again, while its first answer travels
    queue = changeAnswer(queue, 'q2', A)
    queue = changeAnswer(queue, 'q2', C)
    expect(canSend(queue)).toBe(false)
    expect(beginSave(queue).batch).toBeNull()
    expect([...queue.inFlight!]).toEqual([['q1', A]])

    queue = saveSucceeded(queue)
    expect(canSend(queue)).toBe(true)
    const next = begin(queue)
    expect([...next.batch]).toEqual([
      ['q1', B],
      ['q2', C],
    ])
    expect(hasUnsaved(saveSucceeded(next.queue))).toBe(false)
  })

  it('gives a failed request its answers back — first in line — except those changed again meanwhile', () => {
    let queue = changeAnswer(changeAnswer(emptyQueue(), 'q1', A), 'q2', A)
    queue = begin(queue).queue
    queue = changeAnswer(queue, 'q2', B) // newer than the one that failed
    queue = changeAnswer(queue, 'q3', C)
    queue = saveFailed(queue)

    expect(queue.inFlight).toBeNull()
    expect(queue.failures).toBe(1)
    expect([...queue.pending]).toEqual([
      ['q1', A],
      ['q2', B],
      ['q3', C],
    ])
    expect(canSend(queue)).toBe(true)

    // A second failure in a row counts on; a success starts over.
    queue = saveFailed(begin(queue).queue)
    expect(queue.failures).toBe(2)
    expect(queue.pending.size).toBe(3)
    expect(saveSucceeded(begin(queue).queue).failures).toBe(0)
    expect(saveFailed(emptyQueue())).toEqual(emptyQueue())
  })

  it('sends a cleared answer as an entry with neither field, and a true/false answer as a JSON boolean', () => {
    let queue = changeAnswer(emptyQueue(), 'q1', A)
    queue = changeAnswer(queue, 'q1', null) // chosen, then cleared before it was sent: the clear is what goes
    queue = changeAnswer(queue, 'q2', booleanAnswer(false))
    const entries = entriesOf(begin(queue).batch)
    expect(entries).toEqual([{ examQuestionId: 'q1' }, { examQuestionId: 'q2', value: false }])
    expect(entries[0]).not.toHaveProperty('optionId')
    expect(entries[0]).not.toHaveProperty('value')
    expect(JSON.stringify({ answers: entries })).toBe('{"answers":[{"examQuestionId":"q1"},{"examQuestionId":"q2","value":false}]}')
  })

  it('sends at most the batch size the server takes; the rest waits for the next request', () => {
    let queue = emptyQueue()
    for (let index = 0; index < ANSWERS_BATCH_MAX + 5; index += 1) queue = changeAnswer(queue, `q${index}`, A)
    const first = begin(queue)
    expect(first.batch.size).toBe(ANSWERS_BATCH_MAX)
    expect(first.queue.pending.size).toBe(5)
    expect(entriesOf(first.batch)).toHaveLength(ANSWERS_BATCH_MAX)
    const second = begin(saveSucceeded(first.queue))
    expect([...second.batch.keys()]).toEqual([`q${ANSWERS_BATCH_MAX}`, `q${ANSWERS_BATCH_MAX + 1}`, `q${ANSWERS_BATCH_MAX + 2}`, `q${ANSWERS_BATCH_MAX + 3}`, `q${ANSWERS_BATCH_MAX + 4}`])
    expect(begin(changeAnswer(changeAnswer(emptyQueue(), 'q1', A), 'q2', B)).batch.size).toBe(2)
    expect(beginSave(changeAnswer(changeAnswer(emptyQueue(), 'q1', A), 'q2', B), 1).batch?.size).toBe(1)
  })

  it('stops for good once the attempt is closed (attempt_closed): nothing is kept, queued or sent again', () => {
    let queue = begin(changeAnswer(changeAnswer(emptyQueue(), 'q1', A), 'q2', A)).queue
    queue = changeAnswer(queue, 'q3', B)
    queue = closeQueue(queue)

    expect(queue.closed).toBe(true)
    expect(hasUnsaved(queue)).toBe(false)
    expect(canSend(queue)).toBe(false)
    const after = changeAnswer(queue, 'q1', C)
    expect(after).toBe(queue)
    expect(beginSave(after).batch).toBeNull()
  })

  it('names everything the server may not hold yet — the request on its way, then what waits (the newer answer wins)', () => {
    let queue = begin(changeAnswer(changeAnswer(emptyQueue(), 'q1', A), 'q2', A)).queue
    queue = changeAnswer(queue, 'q2', B)
    queue = changeAnswer(queue, 'q3', null)
    expect([...unsavedOf(queue)]).toEqual([
      ['q1', A],
      ['q2', B],
      ['q3', null],
    ])
    expect(unsavedOf(emptyQueue()).size).toBe(0)
  })

  it('drops from the line the answers another request already saved — only while they are still the same', () => {
    let queue = begin(changeAnswer(emptyQueue(), 'q1', A)).queue
    queue = changeAnswer(queue, 'q2', B)
    queue = changeAnswer(queue, 'q3', C)
    const sentWithKeepalive = unsavedOf(queue)
    queue = changeAnswer(queue, 'q3', A) // changed again after the flush left

    const acknowledged = acknowledge(queue, sentWithKeepalive)
    expect([...acknowledged.pending]).toEqual([['q3', A]])
    // The request on its way keeps its own answer.
    expect([...acknowledged.inFlight!]).toEqual([['q1', A]])
    expect(acknowledge(acknowledged, new Map([['q9', A]]))).toBe(acknowledged)
  })

  it('puts the answers of a request that will never be answered back in line without counting a failure', () => {
    const queue = requeueInFlight(begin(changeAnswer(emptyQueue(), 'q1', A)).queue)
    expect(queue.inFlight).toBeNull()
    expect(queue.failures).toBe(0)
    expect([...queue.pending]).toEqual([['q1', A]])
    expect(requeueInFlight(emptyQueue())).toEqual(emptyQueue())
  })
})

describe('retryDelayMs (the growing pause before a failed save is tried again)', () => {
  it('grows with the failures in a row — 2, 4, 8, 15, then 30 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 50].map((failures) => retryDelayMs(failures))).toEqual([2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000])
    expect(retryDelayMs(0)).toBe(RETRY_DELAYS_MS[0])
  })

  it('waits what a 429 asks, within 1 to 60 seconds', () => {
    expect(retryDelayMs(1, 7)).toBe(7_000)
    expect(retryDelayMs(4, 7)).toBe(7_000)
    expect(retryDelayMs(1, 0)).toBe(1_000)
    expect(retryDelayMs(1, 600)).toBe(60_000)
    expect(retryDelayMs(3, null)).toBe(8_000)
    expect(retryDelayMs(3, Number.NaN)).toBe(8_000)
  })
})
