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

describe('YouTubeLesson (J-F64; its frame and «المشاهدة المحتسبة» since J-F69)', () => {
  it('plays inside the page and shows how much was really watched', () => {
    const { frame } = renderLesson()
    expect(frame.getAttribute('src')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(screen.getByText(ar.learn.lesson.watch.notStarted)).toBeInTheDocument()

    play(frame, 0, 25)

    expect(bar()).toHaveAttribute('aria-valuenow', '25')
    // J-F69: «المشاهدة المحتسبة: 00:25 من 01:40 (25٪)», the clocks in two-digit minutes.
    expect(screen.getByText(ar.learn.lesson.watch.counted)).toBeInTheDocument()
    expect(bar().closest('.learn-watch')).toHaveTextContent('00:25 من 01:40 (25٪)')
    expect(screen.getByText('00:25')).toHaveAttribute('dir', 'ltr')
  })

  it('sits in its dark frame with «مشاهدة على YouTube» under it (J-F69)', () => {
    const { container } = renderLesson()
    expect(container.querySelector('.learn-embed--framed iframe')).not.toBeNull()
    const link = screen.getByRole('link', { name: new RegExp(ar.learn.lesson.watch.openOnYouTube) })
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.querySelector('.learn-embed__blocked')).toBeNull()
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
    // The bar reads as full; the line keeps the part this device measured, and the rule is gone.
    expect(bar()).toHaveAttribute('aria-valuenow', '100')
    expect(bar().closest('.learn-watch')).toHaveTextContent('01:35 من 01:40 (95٪)')
    expect(screen.queryByText(/يكتمل الدرس تلقائياً/)).not.toBeInTheDocument()
  })

  it('says a completed lesson is complete before this device measured anything', () => {
    const completed = makeItem('i2', { progress: makeProgress({ state: 'completed', completedAt: '2026-11-20T10:00:00.000Z', completionSource: 'manual' }) })
    renderLesson(vi.fn(() => Promise.resolve()), completed)
    expect(screen.getByText(ar.learn.lesson.watch.done)).toBeInTheDocument()
    expect(bar()).toHaveAttribute('aria-valuenow', '100')
  })

  it('reopens where the learner stopped', () => {
    writeWatched(USER_ID, 'i2', { ranges: [[0, 40]], positionSeconds: 40, durationSeconds: DURATION })
    const { frame } = renderLesson()
    expect(new URL(frame.getAttribute('src')!).searchParams.get('start')).toBe('40')
    expect(bar()).toHaveAttribute('aria-valuenow', '40')
  })

  it('says inside the frame that the owner does not allow it, with the red link to YouTube (J-F69)', () => {
    const { frame, container } = renderLesson()
    fromPlayer(frame, { event: 'onError', info: 150 })
    const notice = screen.getByRole('alert')
    expect(container.querySelector('.learn-embed--framed')).toContainElement(notice)
    expect(notice).toHaveTextContent(ar.learn.lesson.watch.blockedOwner)
    const links = screen.getAllByRole('link', { name: new RegExp(ar.learn.lesson.watch.openOnYouTube) })
    // The red button inside the frame and the link under it.
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(notice.querySelector('.learn-youtube__button')).not.toBeNull()
  })

  it('says only that it cannot play here for any other refusal', () => {
    const { frame } = renderLesson()
    fromPlayer(frame, { event: 'onError', info: 100 })
    expect(screen.getByRole('alert')).toHaveTextContent(ar.learn.lesson.watch.blocked)
    expect(screen.queryByText(ar.learn.lesson.watch.blockedOwner)).not.toBeInTheDocument()
  })

  it('asks the player to report once it has loaded', () => {
    const { frame } = renderLesson()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined)
    fireEvent.load(frame)
    expect(post).toHaveBeenCalledWith(expect.stringContaining('"event":"listening"'), YOUTUBE_PLAYER_ORIGIN)
  })
})
