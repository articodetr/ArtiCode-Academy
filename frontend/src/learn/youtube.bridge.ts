// The conversation with YouTube's embedded player (J-F64), by `postMessage`
// only: YouTube's own script (`iframe_api`) would have to run in this origin —
// beside the session's access token — and the page's CSP (`script-src 'self'`,
// deploy/Caddyfile) rightly forbids it. The player is asked to report once
// (`listening`) and then says where it is. Pure: no DOM, no React.
import { youtubeEmbedUrl } from './learn.format'

/** The only origin whose messages are read (the privacy-enhanced player — D-R131, the page's `frame-src`). */
export const YOUTUBE_PLAYER_ORIGIN = 'https://www.youtube-nocookie.com'

/** YouTube's `playerState` while the video is playing. */
export const YOUTUBE_PLAYING = 1

/** The embed address of a measured player: it reports to `pageOrigin` and opens at `startSeconds`. */
export function trackedYoutubeEmbedUrl(videoId: string, pageOrigin: string, startSeconds = 0): string {
  const query = new URLSearchParams({ enablejsapi: '1', rel: '0', playsinline: '1', origin: pageOrigin })
  const start = Math.floor(startSeconds)
  if (Number.isFinite(start) && start > 0) query.set('start', String(start))
  return `${youtubeEmbedUrl(videoId)}?${query.toString()}`
}

/** Asks the player to start reporting on channel `id`. */
export function listeningMessage(id: string): string {
  return JSON.stringify({ event: 'listening', id, channel: 'widget' })
}

export interface YouTubeUpdate {
  currentTime?: number
  duration?: number
  playerState?: number
  /** YouTube's error code: 2, 5, 100, 101 or 150. */
  errorCode?: number
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parsedBody(data: unknown): Record<string, unknown> | null {
  let body = data
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return null
    }
  }
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/** What one message of the player says, or null for anything that is not a player report. */
export function parseYouTubeMessage(data: unknown): YouTubeUpdate | null {
  const body = parsedBody(data)
  if (!body) return null
  switch (body.event) {
    case 'onReady':
      return {}
    case 'onStateChange': {
      const playerState = finiteOrUndefined(body.info)
      return playerState === undefined ? null : { playerState }
    }
    case 'onError': {
      const errorCode = finiteOrUndefined(body.info)
      return errorCode === undefined ? null : { errorCode }
    }
    case 'initialDelivery':
    case 'infoDelivery': {
      if (typeof body.info !== 'object' || body.info === null) return null
      const info = body.info as Record<string, unknown>
      const update: YouTubeUpdate = {}
      const currentTime = finiteOrUndefined(info.currentTime)
      const duration = finiteOrUndefined(info.duration)
      const playerState = finiteOrUndefined(info.playerState)
      if (currentTime !== undefined && currentTime >= 0) update.currentTime = currentTime
      if (duration !== undefined && duration > 0) update.duration = duration
      if (playerState !== undefined) update.playerState = playerState
      return update
    }
    default:
      return null
  }
}
