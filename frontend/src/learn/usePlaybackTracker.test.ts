// TEST-251 (MOD-20, D-R134) — playback tracking: the intervals actually played
// (a seek never fills its gap), the save cadence, `keepalive` when the page is
// hidden, and a failed save keeping its intervals for the next one.
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackInput, PlaybackResult } from '../api/learning'
import { jsonResponse, mockFetch } from '../test/http'
import { makeCounts, makeProgress } from './learn.fixtures'
import { mergeRanges, PLAYBACK_SAVE_INTERVAL_MS, PlayedIntervals, usePlaybackTracker } from './usePlaybackTracker'

function answer(watchedPercent: number): PlaybackResult {
  return {
    progress: makeProgress({ state: 'in_progress', watchedPercent, watchedSeconds: watchedPercent }),
    course: makeCounts({ total: 4, required: 3 }),
    completedNow: false,
    capped: false,
  }
}

interface Sent {
  body: PlaybackInput
  keepalive: boolean
}

/** Answers every save with `statuses` in turn (200 after the list ends) and records what was sent. */
function server(statuses: number[] = []) {
  const sent: Sent[] = []
  mockFetch((url, init) => {
    expect(url).toBe('/api/me/learning/items/i2/playback')
    expect(init?.method).toBe('PUT')
    sent.push({ body: JSON.parse(String(init?.body)) as PlaybackInput, keepalive: init?.keepalive === true })
    const status = statuses[sent.length - 1] ?? 200
    return status === 200 ? jsonResponse(200, answer(sent.length * 10)) : jsonResponse(status, { statusCode: status, message: 'failed' })
  })
  return sent
}

function player(options: { readyState?: number; startPosition?: number | null } = {}) {
  const media = document.createElement('video')
  let time = 0
  Object.defineProperty(media, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (value: number) => {
      time = value
    },
  })
  Object.defineProperty(media, 'readyState', { configurable: true, get: () => options.readyState ?? 1 })
  const mediaRef = { current: media as HTMLMediaElement }
  const onSaved = vi.fn<(result: PlaybackResult) => void>()
  const hook = renderHook(() => usePlaybackTracker({ mediaRef, itemId: 'i2', enabled: true, startPosition: options.startPosition ?? null, onSaved }))
  const fire = (type: string) => media.dispatchEvent(new Event(type))
  /** Playback reached `seconds` (a `timeupdate`). */
  const at = (seconds: number) => {
    time = seconds
    fire('timeupdate')
  }
  /** Plays from `from` to `to` in quarter seconds, as a browser reports it. */
  const play = (from: number, to: number) => {
    for (let second = from; second <= to + 1e-9; second += 0.25) at(Math.round(second * 100) / 100)
  }
  const seek = (seconds: number) => {
    time = seconds
    fire('seeking')
    fire('timeupdate')
    fire('seeked')
  }
  return { media, fire, at, play, seek, onSaved, hook }
}

/** Lets the mocked requests and their promise chains finish (real timers only). */
async function settle() {
  for (let round = 0; round < 6; round += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PlayedIntervals', () => {
  it('grows while playback moves forward and starts anew after a jump or a step back', () => {
    const intervals = new PlayedIntervals()
    for (const time of [0, 0.5, 1, 1.5, 2]) intervals.observe(time)
    intervals.observe(10) // a jump of 8 s: the gap was not played
    intervals.observe(11)
    intervals.observe(5) // a step back
    intervals.observe(6)
    expect(intervals.take()).toEqual([
      [0, 2],
      [5, 6],
      [10, 11],
    ])
    // Taken once only; an interval still playing continues from where it was cut.
    intervals.observe(7)
    expect(intervals.take()).toEqual([[6, 7]])
  })

  it('merges overlapping or touching intervals', () => {
    expect(
      mergeRanges([
        [5, 8],
        [0, 2],
        [2, 3],
        [7, 9],
        [4, 4],
      ]),
    ).toEqual([
      [0, 3],
      [5, 9],
    ])
  })
})

describe('usePlaybackTracker (TEST-251)', () => {
  it('reports the played intervals: a seek never fills the gap it skipped', async () => {
    const sent = server()
    const { fire, play, seek, at, onSaved } = player()

    fire('play')
    play(0, 3)
    seek(30)
    play(30, 32.5)
    at(40) // a jump without a `seeking` event (more than 2 s) also starts a new interval
    at(41)
    fire('pause')
    await settle()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.body.ranges).toEqual([
      [0, 3],
      [30, 32.5],
      [40, 41],
    ])
    expect(sent[0]!.body.positionSeconds).toBe(41)
    expect(sent[0]!.keepalive).toBe(false)
    // The screen gets the server's answer.
    expect(onSaved).toHaveBeenCalledWith(answer(10))
  })

  it('saves every 15 seconds while playing, only what was played since the last save, and stops on pause', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const sent = server()
    const { fire, play } = player()

    fire('play')
    play(0, 15)
    await vi.advanceTimersByTimeAsync(PLAYBACK_SAVE_INTERVAL_MS)
    await settle()
    expect(sent.map((save) => save.body.ranges)).toEqual([[[0, 15]]])

    play(15.25, 30)
    await vi.advanceTimersByTimeAsync(PLAYBACK_SAVE_INTERVAL_MS)
    await settle()
    expect(sent.map((save) => save.body.ranges)).toEqual([[[0, 15]], [[15, 30]]])

    // Paused where the server already is: nothing new to send, and the cadence stops.
    fire('pause')
    await vi.advanceTimersByTimeAsync(PLAYBACK_SAVE_INTERVAL_MS * 3)
    await settle()
    expect(sent).toHaveLength(2)

    // `ended` saves the last stretch.
    fire('play')
    play(30.25, 35)
    fire('ended')
    await settle()
    expect(sent.map((save) => save.body.ranges)).toEqual([[[0, 15]], [[15, 30]], [[30, 35]]])
  })

  it('saves with keepalive when the page is hidden', async () => {
    const sent = server()
    const { fire, play } = player()
    fire('play')
    play(0, 6)

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
    await settle()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.keepalive).toBe(true)
    expect(sent[0]!.body.ranges).toEqual([[0, 6]])
    // Never on unload events.
    window.dispatchEvent(new Event('beforeunload'))
    window.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(sent).toHaveLength(1)
  })

  it('keeps the intervals of a failed save for the next one', async () => {
    const sent = server([500])
    const { fire, play, onSaved } = player()

    fire('play')
    play(0, 3)
    fire('pause')
    await settle()
    expect(sent).toHaveLength(1)
    expect(onSaved).not.toHaveBeenCalled()

    fire('play')
    play(3.25, 6)
    play(20, 21)
    fire('pause')
    await settle()

    expect(sent).toHaveLength(2)
    expect(sent[1]!.body.ranges).toEqual([
      [0, 6],
      [20, 21],
    ])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('sends what was played when the lesson goes away, and nothing when nothing changed', async () => {
    const sent = server()
    const first = player()
    first.fire('play')
    first.play(0, 4)
    first.hook.unmount()
    await settle()
    expect(sent.map((save) => save.body.ranges)).toEqual([[[0, 4]]])

    // A lesson opened and left without playing (its metadata not even loaded) writes nothing — the position is kept.
    const second = player({ readyState: 0, startPosition: 120 })
    second.hook.unmount()
    await settle()
    expect(sent).toHaveLength(1)
  })
})
