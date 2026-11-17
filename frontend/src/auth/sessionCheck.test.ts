import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { MAX_RETRY_WAIT_MS, sessionCheckDelay, sessionCheckProblem } from './sessionCheck'

const limited = (retryAfterSeconds: number | null) => new ApiError(429, 'Too many requests', { code: 'rate_limited' }, retryAfterSeconds)

describe('sessionCheckDelay', () => {
  it('waits what the server named, at least a second and at most MAX_RETRY_WAIT_MS', () => {
    expect(sessionCheckDelay(limited(7), 0)).toBe(7_000)
    expect(sessionCheckDelay(limited(0), 2)).toBe(1_000)
    expect(sessionCheckDelay(limited(59), 0)).toBe(MAX_RETRY_WAIT_MS)
    expect(MAX_RETRY_WAIT_MS).toBe(30_000)
  })

  it('backs off 1 s, 2 s, 4 s when the server named no wait', () => {
    const offline = new TypeError('Failed to fetch')
    expect([0, 1, 2, 3].map((retry) => sessionCheckDelay(offline, retry))).toEqual([1_000, 2_000, 4_000, 4_000])
    expect(sessionCheckDelay(limited(null), 1)).toBe(2_000)
    expect(sessionCheckDelay(new ApiError(503, 'Service Unavailable'), 0)).toBe(1_000)
  })
})

describe('sessionCheckProblem', () => {
  it('names the cause for the message', () => {
    expect(sessionCheckProblem(limited(5))).toBe('rate_limited')
    expect(sessionCheckProblem(new ApiError(502, 'Bad Gateway'))).toBe('server')
    expect(sessionCheckProblem(new TypeError('Failed to fetch'))).toBe('network')
  })
})
