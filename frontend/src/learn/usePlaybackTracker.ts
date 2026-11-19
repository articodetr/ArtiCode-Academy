// Playback tracking of a measured medium (a `file` video, audio — MOD-20,
// D-R134, API-233). The player reports the intervals it ACTUALLY played; the
// server keeps their union and completes the lesson once it covers the
// academy's share of the authored length. So:
// - an interval grows while `timeupdate` moves forward by at most
//   PLAYBACK_GAP_SECONDS; a larger jump (or any `seeking`, or a step back)
//   closes it and the next one starts where playback resumes — seeking never
//   fills the gap it skipped;
// - a save carries only the intervals played since the last SUCCESSFUL save
//   (at most REPORTED_RANGES_MAX — the rest wait for the next one); a failed
//   save puts its intervals back for the next;
// - saves go every PLAYBACK_SAVE_INTERVAL_MS while playing, on `pause`, on
//   `ended`, when the lesson changes or the player goes away (unmount), and
//   when the page is hidden (`visibilitychange` — with `keepalive`, so the
//   request outlives a closing tab); never on `beforeunload`/`unload`, which
//   are unreliable and block the back/forward cache;
// - the screen shows what the server answered (onSaved), never a local count;
//   an older answer that arrives after a newer one is dropped.
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { savePlayback } from '../api/learning'
import type { PlaybackResult, PlayedRange } from '../api/learning'

export const PLAYBACK_SAVE_INTERVAL_MS = 15_000
/** A forward step larger than this between two `timeupdate`s is a jump, not playback. */
export const PLAYBACK_GAP_SECONDS = 2
/** Ranges one save may carry (the server's REPORTED_RANGES_MAX). */
export const REPORTED_RANGES_MAX = 50
/** The server's bound of a position and of a range end (MEDIA_SECONDS_MAX). */
const MEDIA_SECONDS_MAX = 86_400
/** HTMLMediaElement.HAVE_METADATA: from here on `currentTime` is the medium's real position. */
const HAVE_METADATA = 1

function clampSeconds(value: number): number {
  return Math.min(MEDIA_SECONDS_MAX, Math.max(0, value))
}

/** Sorts, merges overlapping or touching intervals and drops empty ones; values rounded outward to hundredths. */
export function mergeRanges(ranges: readonly PlayedRange[]): PlayedRange[] {
  const cleaned = ranges
    .map(([start, end]): PlayedRange => [clampSeconds(Math.floor(start * 100) / 100), clampSeconds(Math.ceil(end * 100) / 100)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: PlayedRange[] = []
  for (const [start, end] of cleaned) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** The played intervals of one lesson's medium between two saves. */
export class PlayedIntervals {
  private open: PlayedRange | null = null
  private closed: PlayedRange[] = []

  /** A `timeupdate` at `time` seconds. */
  observe(time: number) {
    if (!Number.isFinite(time)) return
    const open = this.open
    if (open === null) {
      this.open = [time, time]
      return
    }
    if (time >= open[1] && time - open[1] <= PLAYBACK_GAP_SECONDS) {
      open[1] = time
      return
    }
    // A jump forward or a step back: the gap was not played.
    this.close()
    this.open = [time, time]
  }

  /** `seeking`: the interval ends where it was last seen playing; the next starts at the next `timeupdate`. */
  interrupt() {
    this.close()
  }

  /** The intervals to send now; an interval still playing is cut here and continues from its end. */
  take(): PlayedRange[] {
    const open = this.open
    if (open && open[1] > open[0]) {
      this.closed.push([open[0], open[1]])
      this.open = [open[1], open[1]]
    }
    const taken = mergeRanges(this.closed)
    this.closed = []
    return taken
  }

  /** Intervals a failed save (or a full one) gives back for the next save. */
  restore(ranges: readonly PlayedRange[]) {
    this.closed.unshift(...ranges.map(([start, end]): PlayedRange => [start, end]))
  }

  private close() {
    const open = this.open
    if (open && open[1] > open[0]) this.closed.push([open[0], open[1]])
    this.open = null
  }
}

export interface PlaybackTrackerOptions {
  /** The `<video>` or `<audio>` element, mounted before the hook's effect runs. */
  mediaRef: RefObject<HTMLMediaElement | null>
  itemId: string
  /** Only a lesson whose completionMode is `playback` is tracked. */
  enabled: boolean
  /** The position the server already holds (API-231 progress.positionSeconds): leaving it unchanged sends nothing. */
  startPosition?: number | null
  /** The server's answer to a save (watched share, completion). */
  onSaved?: (result: PlaybackResult) => void
}

export function usePlaybackTracker({ mediaRef, itemId, enabled, startPosition = null, onSaved }: PlaybackTrackerOptions): void {
  const onSavedRef = useRef(onSaved)
  // Read when tracking starts; a later answer moving the position must not restart the tracking.
  const startPositionRef = useRef(startPosition)
  useEffect(() => {
    onSavedRef.current = onSaved
    startPositionRef.current = startPosition
  })

  useEffect(() => {
    const media = mediaRef.current
    if (!enabled || !media) return
    const intervals = new PlayedIntervals()
    let timer: ReturnType<typeof setInterval> | null = null
    const start = startPositionRef.current
    let savedPosition: number | null = typeof start === 'number' && Number.isFinite(start) ? Math.floor(clampSeconds(start)) : null
    let sent = 0
    let applied = 0

    const positionNow = () => Math.floor(clampSeconds(Number.isFinite(media.currentTime) ? media.currentTime : 0))

    const save = (keepalive = false) => {
      const ranges = intervals.take()
      const batch = ranges.slice(0, REPORTED_RANGES_MAX)
      const rest = ranges.slice(REPORTED_RANGES_MAX)
      if (rest.length > 0) intervals.restore(rest)
      const positionSeconds = positionNow()
      if (batch.length === 0) {
        // Nothing played: only a position the learner moved to is worth a save — never one read before the
        // medium's metadata (it would be 0 and erase where the learner stopped), never the one the server holds.
        if (media.readyState < HAVE_METADATA) return
        if (savedPosition === null ? positionSeconds === 0 : savedPosition === positionSeconds) return
      }
      const order = ++sent
      savePlayback(itemId, { positionSeconds, ranges: batch }, { keepalive }).then(
        (result) => {
          savedPosition = positionSeconds
          if (order < applied) return
          applied = order
          onSavedRef.current?.(result)
        },
        () => {
          // Kept for the next save; the server credits them then (its clock allows the time that passed).
          intervals.restore(batch)
        },
      )
    }

    const stopTimer = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const onPlay = () => {
      if (timer === null) timer = setInterval(() => save(), PLAYBACK_SAVE_INTERVAL_MS)
    }
    const onTimeUpdate = () => intervals.observe(media.currentTime)
    const onSeeking = () => intervals.interrupt()
    const onStop = () => {
      intervals.observe(media.currentTime)
      stopTimer()
      save()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save(true)
    }

    media.addEventListener('play', onPlay)
    media.addEventListener('timeupdate', onTimeUpdate)
    media.addEventListener('seeking', onSeeking)
    media.addEventListener('pause', onStop)
    media.addEventListener('ended', onStop)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      media.removeEventListener('play', onPlay)
      media.removeEventListener('timeupdate', onTimeUpdate)
      media.removeEventListener('seeking', onSeeking)
      media.removeEventListener('pause', onStop)
      media.removeEventListener('ended', onStop)
      document.removeEventListener('visibilitychange', onVisibility)
      stopTimer()
      // The lesson changes or the player goes away: what was played since the last save is sent now.
      save()
    }
  }, [mediaRef, itemId, enabled])
}
