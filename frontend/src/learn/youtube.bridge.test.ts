import { describe, expect, it } from 'vitest'
import { listeningMessage, parseYouTubeMessage, trackedYoutubeEmbedUrl } from './youtube.bridge'

describe('trackedYoutubeEmbedUrl', () => {
  it('builds the privacy-enhanced player that reports to this page', () => {
    const url = new URL(trackedYoutubeEmbedUrl('dQw4w9WgXcQ', 'https://academy.example.org'))
    expect(`${url.origin}${url.pathname}`).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(url.searchParams.get('enablejsapi')).toBe('1')
    expect(url.searchParams.get('origin')).toBe('https://academy.example.org')
    expect(url.searchParams.has('start')).toBe(false)
  })

  it('opens at a whole second when the learner stopped somewhere', () => {
    expect(new URL(trackedYoutubeEmbedUrl('dQw4w9WgXcQ', 'https://a.example', 61.9)).searchParams.get('start')).toBe('61')
    expect(new URL(trackedYoutubeEmbedUrl('dQw4w9WgXcQ', 'https://a.example', 0.4)).searchParams.has('start')).toBe(false)
  })
})

describe('parseYouTubeMessage', () => {
  it('reads the time, length and state of a report, as a string or an object', () => {
    const report = { event: 'infoDelivery', info: { currentTime: 12.5, duration: 300, playerState: 1 } }
    expect(parseYouTubeMessage(JSON.stringify(report))).toEqual({ currentTime: 12.5, duration: 300, playerState: 1 })
    expect(parseYouTubeMessage(report)).toEqual({ currentTime: 12.5, duration: 300, playerState: 1 })
  })

  it('reads a state change and an error', () => {
    expect(parseYouTubeMessage({ event: 'onStateChange', info: 2 })).toEqual({ playerState: 2 })
    expect(parseYouTubeMessage({ event: 'onError', info: 150 })).toEqual({ errorCode: 150 })
    expect(parseYouTubeMessage({ event: 'onReady' })).toEqual({})
  })

  it('drops values that are not usable', () => {
    expect(parseYouTubeMessage({ event: 'infoDelivery', info: { currentTime: -1, duration: 0, playerState: 'x' } })).toEqual({})
  })

  it('ignores anything that is not a player report', () => {
    for (const data of ['not json', 42, null, [], { event: 'other' }, { event: 'infoDelivery' }, { event: 'onError', info: 'x' }]) {
      expect(parseYouTubeMessage(data)).toBeNull()
    }
  })

  it('asks the player to report on a named channel', () => {
    expect(JSON.parse(listeningMessage('c1'))).toEqual({ event: 'listening', id: 'c1', channel: 'widget' })
  })
})
