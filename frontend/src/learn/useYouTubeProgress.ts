// Follows an embedded YouTube player and measures what the learner actually
// played (J-F64), with the rule of a measured medium (usePlaybackTracker —
// D-R134): an interval grows only while the video plays, and a jump never fills
// the part it skipped. Messages are read from the player's own window and origin
// only. Once the watched share reaches the academy's `completionPercent` the
// lesson is completed through the server (API-234 — `onReached`), once; a failed
// request is tried again after RETRY_MS while the learner keeps watching.
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { PlayedIntervals } from './usePlaybackTracker'
import { readWatched, watchedPercentOf, writeWatched, coveredSeconds } from './watched.store'
import type { WatchedEntry } from './watched.store'
import { YOUTUBE_PLAYER_ORIGIN, YOUTUBE_PLAYING, listeningMessage, parseYouTubeMessage } from './youtube.bridge'

const LISTEN_EVERY_MS = 500
const LISTEN_ATTEMPTS = 20
const SAVE_EVERY_MS = 3_000
const RETRY_MS = 30_000

export interface YouTubeProgress {
  /** Null until the video's length is known. */
  percent: number | null
  watchedSeconds: number
  durationSeconds: number | null
  /** YouTube refused to play the video here (a removed video, embedding turned off…). */
  errorCode: number | null
}

export interface YouTubeProgressOptions {
  frameRef: RefObject<HTMLIFrameElement | null>
  userId: string
  itemId: string
  /** The academy's share of a video that completes it. */
  completionPercent: number
  /** The server already holds the lesson as completed. */
  completed: boolean
  /** Completes the lesson on the server; rejects when it could not. */
  onReached: () => Promise<void>
}

function summaryOf(entry: WatchedEntry | null): Omit<YouTubeProgress, 'errorCode'> {
  return {
    percent: watchedPercentOf(entry),
    watchedSeconds: entry ? coveredSeconds(entry.ranges) : 0,
    durationSeconds: entry?.durationSeconds ?? null,
  }
}

export function useYouTubeProgress({ frameRef, userId, itemId, completionPercent, completed, onReached }: YouTubeProgressOptions): YouTubeProgress {
  const [summary, setSummary] = useState(() => summaryOf(readWatched(userId, itemId)))
  const [errorCode, setErrorCode] = useState<number | null>(null)
  const latest = useRef({ completed, onReached, completionPercent })
  useEffect(() => {
    latest.current = { completed, onReached, completionPercent }
  })

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const channel = `articode-youtube-${itemId}`
    const intervals = new PlayedIntervals()
    let playing = false
    let connected = false
    let attempts = 0
    let listenTimer: ReturnType<typeof setInterval> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let asked = false
    let lastSave = 0
    let position: number | null = null
    let duration: number | null = null

    const stopListening = () => {
      if (listenTimer !== null) clearInterval(listenTimer)
      listenTimer = null
    }

    const askCompletion = () => {
      if (asked || latest.current.completed) return
      asked = true
      latest.current.onReached().catch(() => {
        retryTimer = setTimeout(() => {
          asked = false
        }, RETRY_MS)
      })
    }

    const save = () => {
      lastSave = Date.now()
      const ranges = intervals.take()
      // Nothing played and nothing learned: the stored position is not overwritten by the player's opening report.
      if (ranges.length === 0 && duration === null) return
      const entry = writeWatched(userId, itemId, {
        ranges,
        ...(ranges.length > 0 && position !== null ? { positionSeconds: position } : {}),
        ...(duration !== null ? { durationSeconds: duration } : {}),
      })
      setSummary(summaryOf(entry))
      const percent = watchedPercentOf(entry)
      if (percent !== null && percent >= latest.current.completionPercent) askCompletion()
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_PLAYER_ORIGIN || event.source !== frame.contentWindow) return
      const update = parseYouTubeMessage(event.data)
      if (!update) return
      if (!connected) {
        connected = true
        stopListening()
      }
      if (update.errorCode !== undefined) {
        playing = false
        intervals.interrupt()
        setErrorCode(update.errorCode)
        save()
        return
      }
      if (update.duration !== undefined) duration = update.duration
      if (update.playerState !== undefined) {
        const nowPlaying = update.playerState === YOUTUBE_PLAYING
        if (playing && !nowPlaying) {
          // The last report before a pause is where the interval ends.
          if (update.currentTime !== undefined) intervals.observe(update.currentTime)
          intervals.interrupt()
          if (update.currentTime !== undefined) position = update.currentTime
          playing = false
          save()
          return
        }
        playing = nowPlaying
      }
      if (update.currentTime !== undefined && playing) {
        position = update.currentTime
        intervals.observe(update.currentTime)
        if (Date.now() - lastSave >= SAVE_EVERY_MS) save()
      }
    }

    const listen = () => {
      if (connected) return
      attempts += 1
      if (attempts > LISTEN_ATTEMPTS) {
        stopListening()
        return
      }
      frame.contentWindow?.postMessage(listeningMessage(channel), YOUTUBE_PLAYER_ORIGIN)
    }
    const onLoad = () => {
      stopListening()
      connected = false
      attempts = 0
      listen()
      listenTimer = setInterval(listen, LISTEN_EVERY_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }

    window.addEventListener('message', onMessage)
    frame.addEventListener('load', onLoad)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('message', onMessage)
      frame.removeEventListener('load', onLoad)
      document.removeEventListener('visibilitychange', onVisibility)
      stopListening()
      if (retryTimer !== null) clearTimeout(retryTimer)
      save()
    }
  }, [frameRef, userId, itemId])

  return { ...summary, errorCode }
}
