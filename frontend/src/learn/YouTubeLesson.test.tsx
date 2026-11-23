import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ar } from '../i18n/ar'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { makeItem, makeProgress } from './learn.fixtures'
import { readWatched, resetWatchedMemory, writeWatched } from './watched.store'
import { YOUTUBE_PLAYER_ORIGIN } from './youtube.bridge'
import { YouTubeLesson } from './YouTubeLesson'

const USER_ID = 'student-1'
const DURATION = 100

function renderLesson(onComplete = vi.fn(() => Promise.resolve()), item = makeItem('i2')) {
  const view = renderWithProviders(
    <YouTubeLesson item={item} videoId="dQw4w9WgXcQ" watchUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="فيديو الترحيب" onComplete={onComplete} />,
    { auth: makeAuth({ user: makeUser({ id: USER_ID, role: 'student', roles: ['student'] }) }) },
  )
  const frame = view.container.querySelector('iframe')!
  return { ...view, frame, onComplete }
}

function fromPlayer(frame: HTMLIFrameElement, body: unknown, origin = YOUTUBE_PLAYER_ORIGIN, source: Window | null = frame.contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(body), origin, source }))
  })
}

const report = (frame: HTMLIFrameElement, currentTime: number, playerState = 1) =>
  fromPlayer(frame, { event: 'infoDelivery', info: { currentTime, duration: DURATION, playerState } })

/** Plays from `from` to `to`, one report a second, then pauses (a pause saves). */
function play(frame: HTMLIFrameElement, from: number, to: number) {
  for (let time = from; time <= to; time += 1) report(frame, time)
  report(frame, to, 2)
}

const bar = () => screen.getByRole('progressbar', { name: ar.learn.lesson.watch.label })

beforeEach(() => {
  window.localStorage.clear()
  resetWatchedMemory()
})

describe('YouTubeLesson (J-F64)', () => {
  it('plays inside the page and shows how much was really watched', () => {
    const { frame } = renderLesson()
    expect(frame.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(screen.getByText(ar.learn.lesson.watch.notStarted)).toBeInTheDocument()

    play(frame, 0, 25)

    expect(bar()).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('شاهدت 25٪')).toBeInTheDocument()
    expect(screen.getByText('0:25')).toBeInTheDocument()
    expect(screen.getByText('1:40')).toBeInTheDocument()
  })

  it('does not credit the part a jump skipped', () => {
    const { frame } = renderLesson()
    play(frame, 0, 10)
    report(frame, 80)
    report(frame, 81)
    report(frame, 81, 2)
    expect(bar()).toHaveAttribute('aria-valuenow', '11')
  })

  it('reads the messages of its own player only', () => {
    const { frame } = renderLesson()
    fromPlayer(frame, { event: 'infoDelivery', info: { currentTime: 1, duration: DURATION, playerState: 1 } }, 'https://evil.example')
    fromPlayer(frame, { event: 'infoDelivery', info: { currentTime: 50, duration: DURATION, playerState: 2 } }, YOUTUBE_PLAYER_ORIGIN, window)
    expect(readWatched(USER_ID, 'i2')).toBeNull()
    expect(screen.getByText(ar.learn.lesson.watch.notStarted)).toBeInTheDocument()
  })

  it('completes the lesson through the server once, at the academy share', async () => {
    const { frame, onComplete } = renderLesson()
    play(frame, 0, 89)
    expect(onComplete).not.toHaveBeenCalled()
    play(frame, 89, 92)
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('i2'))
    play(frame, 92, 95)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('never asks to complete a lesson the server already holds as completed', () => {
    const completed = makeItem('i2', { progress: makeProgress({ state: 'completed', completedAt: '2026-11-20T10:00:00.000Z', completionSource: 'manual' }) })
    const { frame, onComplete } = renderLesson(vi.fn(() => Promise.resolve()), completed)
    play(frame, 0, 95)
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByText(ar.learn.lesson.watch.done)).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '100')
  })

  it('reopens where the learner stopped', () => {
    writeWatched(USER_ID, 'i2', { ranges: [[0, 40]], positionSeconds: 40, durationSeconds: DURATION })
    const { frame } = renderLesson()
    expect(new URL(frame.getAttribute('src')!).searchParams.get('start')).toBe('40')
    expect(bar()).toHaveAttribute('aria-valuenow', '40')
  })

  it('says so and links to YouTube when the video refuses to play here', () => {
    const { frame } = renderLesson()
    fromPlayer(frame, { event: 'onError', info: 150 })
    expect(screen.getByText(ar.learn.lesson.watch.blocked)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: new RegExp(ar.learn.lesson.watch.openOnYouTube) })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('asks the player to report once it has loaded', () => {
    const { frame } = renderLesson()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined)
    fireEvent.load(frame)
    expect(post).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), YOUTUBE_PLAYER_ORIGIN)
  })
})
