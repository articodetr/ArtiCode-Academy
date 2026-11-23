import { beforeEach, describe, expect, it } from 'vitest'
import { coveredSeconds, readWatched, resetWatchedMemory, resumeSecondsOf, watchedPercentOf, writeWatched } from './watched.store'

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('watched.store', () => {
  it('keeps the union of what was played, so watching a part twice counts once', () => {
    writeWatched('u1', 'i1', { ranges: [[0, 30]], positionSeconds: 30, durationSeconds: 100 })
    const entry = writeWatched('u1', 'i1', { ranges: [[10, 40]], positionSeconds: 40 })
    expect(entry.ranges).toEqual([[0, 40]])
    expect(coveredSeconds(entry.ranges)).toBe(40)
    expect(watchedPercentOf(entry)).toBe(40)
  })

  it('survives a reload of the page, per user and per lesson', () => {
    writeWatched('u1', 'i1', { ranges: [[0, 20]], positionSeconds: 20, durationSeconds: 100 })
    resetWatchedMemory()
    expect(readWatched('u1', 'i1')?.ranges).toEqual([[0, 20]])
    expect(readWatched('u2', 'i1')).toBeNull()
    expect(readWatched('u1', 'i2')).toBeNull()
  })

  it('keeps what another tab added since this page last read the entry', () => {
    writeWatched('u1', 'i1', { ranges: [[0, 10]], positionSeconds: 10, durationSeconds: 100 })
    window.localStorage.setItem('articode.watched.v1:u1:i1', JSON.stringify({ ranges: [[50, 70]], positionSeconds: 70, durationSeconds: 100 }))
    const entry = writeWatched('u1', 'i1', { ranges: [[10, 12]] })
    expect(entry.ranges).toEqual([[0, 12], [50, 70]])
    expect(entry.positionSeconds).toBe(70)
  })

  it('has no percent before the length is known, floors it and never passes 100', () => {
    expect(watchedPercentOf(null)).toBeNull()
    expect(watchedPercentOf({ ranges: [[0, 10]], positionSeconds: 10, durationSeconds: null })).toBeNull()
    expect(watchedPercentOf({ ranges: [[0, 89.9]], positionSeconds: 0, durationSeconds: 100 })).toBe(89)
    expect(watchedPercentOf({ ranges: [[0, 120]], positionSeconds: 0, durationSeconds: 100 })).toBe(100)
  })

  it('resumes where the learner stopped, except at the very end', () => {
    expect(resumeSecondsOf(null)).toBe(0)
    expect(resumeSecondsOf({ ranges: [], positionSeconds: 42, durationSeconds: 100 })).toBe(42)
    expect(resumeSecondsOf({ ranges: [], positionSeconds: 97, durationSeconds: 100 })).toBe(0)
  })

  it('reads a damaged entry as nothing and drops damaged intervals', () => {
    window.localStorage.setItem('articode.watched.v1:u1:i1', 'not json')
    expect(readWatched('u1', 'i1')).toBeNull()
    window.localStorage.setItem('articode.watched.v1:u1:i2', JSON.stringify({ ranges: [[5, 2], ['a', 3], [1, 4]], positionSeconds: -3, durationSeconds: 'x' }))
    expect(readWatched('u1', 'i2')).toEqual({ ranges: [[1, 4]], positionSeconds: 0, durationSeconds: null })
  })
})
