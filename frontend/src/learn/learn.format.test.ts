// TEST-251 (MOD-20) — the pure helpers of the course player: level names
// (D-R130), lesson lengths, the paragraphs of a text lesson, embed addresses
// (D-R131), and carrying a server answer into the workspace (D-R133/D-R134).
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { fileNameOf, formatClockDuration, isHttpsUrl, itemDurationLabel, levelName, levelOrdinal, paragraphsOf, vimeoEmbedUrl, youtubeEmbedUrl } from './learn.format'
import { makeCounts, makeProgress, makeWorkspace } from './learn.fixtures'
import { completesCourse, mergeProgress, openingItemOf, placeOf, sectionKeyOf, withItemProgress } from './learn.state'

const ar = i18n.getFixedT('ar')
const en = i18n.getFixedT('en')

describe('level names (D-R130)', () => {
  it('names levels by the shared Arabic ordinal (1..99), then by the number', () => {
    const words = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر']
    words.forEach((word, index) => expect(levelOrdinal(index + 1, 'ar')).toBe(word))
    expect(levelName({ number: 1, title: null }, ar, 'ar')).toBe('المستوى الأول')
    expect(levelName({ number: 10, title: null }, ar, 'ar')).toBe('المستوى العاشر')
    expect(levelName({ number: 11, title: null }, ar, 'ar')).toBe('المستوى الحادي عشر')
    expect(levelName({ number: 100, title: null }, ar, 'ar')).toBe('المستوى 100')
  })

  it('adds the title when the level has one, in the UI language with the Arabic fallback', () => {
    expect(levelName({ number: 2, title: { ar: 'المتغيرات', en: 'Variables' } }, ar, 'ar')).toBe('المستوى الثاني — المتغيرات')
    expect(levelName({ number: 2, title: { ar: 'المتغيرات', en: 'Variables' } }, en, 'en')).toBe('Level 2 — Variables')
    expect(levelName({ number: 3, title: { ar: 'الدوال' } }, en, 'en')).toBe('Level 3 — الدوال')
    expect(levelName({ number: 12, title: { ar: '  ' } }, en, 'en')).toBe('Level 12')
  })
})

describe('lesson lengths', () => {
  it('formats a medium as a clock', () => {
    expect(formatClockDuration(0)).toBe('0:00')
    expect(formatClockDuration(65)).toBe('1:05')
    expect(formatClockDuration(720)).toBe('12:00')
    expect(formatClockDuration(3725)).toBe('1:02:05')
    expect(formatClockDuration(null)).toBeNull()
    expect(formatClockDuration(-1)).toBeNull()
  })

  it('shows a video or audio by its clock and anything else by its minutes', () => {
    expect(itemDurationLabel({ kind: 'video', durationSeconds: 245, estimatedMinutes: 5 }, ar)).toEqual({ text: '4:05', clock: true })
    expect(itemDurationLabel({ kind: 'audio', durationSeconds: 90, estimatedMinutes: null }, ar)).toEqual({ text: '1:30', clock: true })
    expect(itemDurationLabel({ kind: 'text', durationSeconds: 2700, estimatedMinutes: 45 }, ar)).toEqual({ text: '45 د', clock: false })
    expect(itemDurationLabel({ kind: 'pdf', durationSeconds: 600, estimatedMinutes: null }, en)).toEqual({ text: '10 min', clock: false })
    expect(itemDurationLabel({ kind: 'video', durationSeconds: null, estimatedMinutes: null }, ar)).toBeNull()
  })
})

describe('plain text and addresses (D-R131)', () => {
  it('splits paragraphs on blank lines and keeps the line breaks inside one', () => {
    expect(paragraphsOf('أول\nسطر ثانٍ\n\n  \nثانية\r\n\r\nثالثة')).toEqual(['أول\nسطر ثانٍ', 'ثانية', 'ثالثة'])
    expect(paragraphsOf('<b>نص</b>')).toEqual(['<b>نص</b>'])
    expect(paragraphsOf('\n\n')).toEqual([])
  })

  it('embeds through the privacy-enhanced players', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(vimeoEmbedUrl('76979871')).toBe('https://player.vimeo.com/video/76979871?dnt=1')
  })

  it('accepts https addresses only and names a file by the author or its address', () => {
    expect(isHttpsUrl('https://example.org/a.pdf')).toBe(true)
    expect(isHttpsUrl('http://example.org/a.pdf')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(fileNameOf('https://example.org/files/%D9%85%D9%84%D9%81.zip', null)).toBe('ملف.zip')
    expect(fileNameOf('https://example.org/files/a.zip', ' notes.zip ')).toBe('notes.zip')
    expect(fileNameOf('https://example.org/', null)).toBeNull()
  })
})

describe('carrying an answer into the workspace (D-R133/D-R134)', () => {
  it('finds a lesson and its level, and opens the resume target unless it proved gone', () => {
    const workspace = makeWorkspace()
    expect(placeOf(workspace, 'i3')?.section.id).toBe('s2')
    expect(placeOf(workspace, 'nope')).toBeNull()
    expect(sectionKeyOf({ id: null })).toBe('loose')
    expect(openingItemOf(workspace)).toBe('i2')
    expect(openingItemOf(workspace, new Set(['i2']))).toBe('i1')
    expect(openingItemOf(makeWorkspace({ resume: null, sections: [] }))).toBeNull()
  })

  it('moves the lesson, its level and the course as the answer says, never back from completed', () => {
    const workspace = makeWorkspace()
    const done = makeProgress({ state: 'completed', completedAt: '2026-11-19T09:00:00.000Z', completionSource: 'manual' })
    const section = makeCounts({ total: 2, required: 1, completed: 1, completedRequired: 1, percent: 100, isComplete: true })
    const course = makeCounts({ total: 4, required: 3, completed: 2, completedRequired: 2, percent: 66 })
    const after = withItemProgress(workspace, 'i3', done, { section, course })
    expect(placeOf(after, 'i3')?.item.state).toBe('completed')
    expect(placeOf(after, 'i3')?.section.progress).toEqual(section)
    expect(after.progress).toEqual(course)
    expect(placeOf(after, 'i1')?.section.progress).toEqual(workspace.sections[0]!.progress)

    // A late, older answer (a visit) does not turn it back.
    const late = withItemProgress(after, 'i3', makeProgress({ state: 'in_progress' }))
    expect(placeOf(late, 'i3')?.item.state).toBe('completed')
    expect(mergeProgress(done, makeProgress({ state: 'in_progress' }))).toBe(done)
    expect(mergeProgress(null, done)).toBe(done)
  })

  it('confirms the course only from an answer that completed it', () => {
    const before = makeCounts({ required: 3, completedRequired: 2, percent: 66 })
    const complete = makeCounts({ required: 3, completedRequired: 3, percent: 100, isComplete: true })
    expect(completesCourse(before, complete, true)).toBe(true)
    expect(completesCourse(before, complete, false)).toBe(false)
    expect(completesCourse(complete, complete, true)).toBe(false)
    expect(completesCourse(before, undefined, true)).toBe(false)
    expect(completesCourse(before, before, true)).toBe(false)
  })
})
