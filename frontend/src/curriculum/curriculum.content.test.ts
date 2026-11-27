// MOD-20 — the content form's pure rules: the mirrors of the server's URL checks, the form filled from a stored
// content, the API-228 body of each kind, and the dirty check.
import { describe, expect, it } from 'vitest'
import { makeCurriculumItem } from '../test/curriculum'
import { buildLessonContentInput, contentFormHasChanges, contentFormValuesOf, isHttpsUrl, isMediaMinutes, MEDIA_MINUTES_MAX, minutesOf, needsDuration, secondsOf, vimeoIdOf, youtubeIdOf } from './curriculum.content'

describe('curriculum content (MOD-20)', () => {
  it('mirrors the server: https only, a YouTube or Vimeo link that names a video', () => {
    expect([' https://a.example/x ', 'http://a.example/x', 'https://a b', 'ftp://x', ''].map(isHttpsUrl)).toEqual([true, false, false, false, false])
    expect(youtubeIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdOf('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdOf('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeIdOf('http://youtu.be/dQw4w9WgXcQ')).toBeNull()
    expect(youtubeIdOf('https://www.youtube.com/watch')).toBeNull()
    expect(vimeoIdOf('https://vimeo.com/123456')).toBe('123456')
    expect(vimeoIdOf('https://player.vimeo.com/video/987')).toBe('987')
    expect(vimeoIdOf('https://vimeo.com/channels/staff')).toBeNull()
    expect([needsDuration('audio', undefined), needsDuration('video', 'file'), needsDuration('video', 'youtube'), needsDuration('pdf', 'file')]).toEqual([true, true, false, false])
  })

  it('fills the form from a stored video and builds the same body back, without the server-made videoId', () => {
    const item = makeCurriculumItem({
      kind: 'video',
      content: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 212 },
      resources: [{ title: { ar: 'ملخص', tr: 'Özet' }, url: 'https://cdn.example.org/s.pdf' }],
    })
    const values = contentFormValuesOf(item)
    expect(values).toMatchObject({ kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationMinutes: 3.53 })
    expect(buildLessonContentInput(values, item)).toEqual({
      kind: 'video',
      content: { provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: 212 },
      resources: [{ title: { ar: 'ملخص', tr: 'Özet' }, url: 'https://cdn.example.org/s.pdf' }],
    })
    expect(contentFormHasChanges(item, values)).toBe(false)
    expect(contentFormHasChanges(item, { ...values, durationMinutes: 3.55 })).toBe(true)
  })

  it('builds the body of each kind from its own fields only', () => {
    const item = makeCurriculumItem()
    const base = { ...contentFormValuesOf(item), url: ' https://cdn.example.org/f ', durationMinutes: 1.5, altAr: 'وصف', fileName: '  ', noteAr: '' }
    expect(buildLessonContentInput({ ...base, kind: 'audio' }, item).content).toEqual({ url: 'https://cdn.example.org/f', durationSeconds: 90 })
    expect(buildLessonContentInput({ ...base, kind: 'pdf' }, item).content).toEqual({ url: 'https://cdn.example.org/f' })
    expect(buildLessonContentInput({ ...base, kind: 'image' }, item).content).toEqual({ url: 'https://cdn.example.org/f', alt: { ar: 'وصف' } })
    expect(buildLessonContentInput({ ...base, kind: 'file' }, item).content).toEqual({ url: 'https://cdn.example.org/f', fileName: null })
    expect(buildLessonContentInput({ ...base, kind: 'live' }, item).content).toEqual({ note: null })
    expect(buildLessonContentInput({ ...base, kind: 'text' }, item).content).toBeNull()
    expect(buildLessonContentInput({ ...base, kind: 'pdf', url: '' }, item).content).toBeNull()
  })

  it('types a length in minutes and sends whole seconds; a stored length reads back to the same seconds (PORTAL-04-MINUTES)', () => {
    expect(secondsOf(12.5)).toBe(750)
    expect(secondsOf(2.08)).toBe(125)
    expect(minutesOf(750)).toBe(12.5)
    expect(minutesOf(125)).toBe(2.08)
    for (const seconds of [1, 59, 61, 125, 212, 3599, 86_399, 86_400]) expect(secondsOf(minutesOf(seconds))).toBe(seconds)
    expect([12, 12.5, 0.02, MEDIA_MINUTES_MAX].map(isMediaMinutes)).toEqual([true, true, true, true])
    expect([0, -1, 12.345, 0.001, MEDIA_MINUTES_MAX + 0.01, Number.NaN].map(isMediaMinutes)).toEqual([false, false, false, false, false, false])
    const item = makeCurriculumItem({ kind: 'audio', content: { url: 'https://cdn.example.org/a.mp3', durationSeconds: 125 } })
    const values = contentFormValuesOf(item)
    expect(values.durationMinutes).toBe(2.08)
    expect(buildLessonContentInput({ ...values, durationMinutes: 12.5 }, item).content).toEqual({ url: 'https://cdn.example.org/a.mp3', durationSeconds: 750 })
    expect(contentFormHasChanges(item, values)).toBe(false)
  })
})
