import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { jsonResponse, mockFetch } from '../test/http'
import { LESSON_ID, LESSON_ID_2, makeLesson, makeLessonList } from '../test/lessons'
import { RECENT_LESSONS_DAYS, lessonSelectHint, recentLessonsFrom, useClassLessons } from './useClassLessons'

const DAY_MS = 86_400_000
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

/** The first lesson of a long class (January) and one of its recent ones. */
const oldest = makeLesson({ id: LESSON_ID, startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:30:00.000Z' })
const recent = makeLesson({ id: LESSON_ID_2, startsAt: '2026-11-03T09:00:00.000Z', endsAt: '2026-11-03T10:30:00.000Z' })

/** Answers GET /api/lessons with `answer(query)` and records every query. */
function record(answer: (query: URLSearchParams) => Response) {
  const queries: URLSearchParams[] = []
  mockFetch((url) => {
    const query = new URL(url, 'http://localhost').searchParams
    queries.push(query)
    return answer(query)
  })
  return queries
}

const asObject = (query: URLSearchParams) => Object.fromEntries(query)

describe('useClassLessons', () => {
  it('offers a class that fits one page whole, from one read by start time', async () => {
    const queries = record(() => jsonResponse(200, makeLessonList([oldest, recent])))
    const { result } = renderHook(() => useClassLessons('class-1', true))

    await waitFor(() => expect(result.current.lessons).toHaveLength(2))
    expect(result.current).toMatchObject({ loading: false, error: false, truncated: false, recent: false })
    expect(queries.map(asObject)).toEqual([{ classId: 'class-1', order: 'asc', limit: '100' }])
  })

  it('offers a class longer than one page from RECENT_LESSONS_DAYS days ago on — its recent and coming lessons, not its oldest (the owner’s note 2 on #87)', async () => {
    const queries = record((query) => jsonResponse(200, query.has('from') ? makeLessonList([recent], 'next-2') : makeLessonList([oldest], 'next-1')))
    const before = Date.now()
    const { result } = renderHook(() => useClassLessons('class-1', true))

    await waitFor(() => expect(result.current.recent).toBe(true))
    const after = Date.now()
    expect(result.current).toMatchObject({ loading: false, error: false, truncated: true })
    expect(result.current.lessons.map((lesson) => lesson.id)).toEqual([LESSON_ID_2])
    expect(queries).toHaveLength(2)
    const { from, ...second } = asObject(queries[1]!)
    expect(second).toEqual({ classId: 'class-1', order: 'asc', limit: '100' })
    expect(Date.parse(from!)).toBeGreaterThanOrEqual(before - RECENT_LESSONS_DAYS * DAY_MS)
    expect(Date.parse(from!)).toBeLessThanOrEqual(after - RECENT_LESSONS_DAYS * DAY_MS)
  })

  it('keeps the first page of a long class whose lessons all lie further back', async () => {
    const queries = record((query) => jsonResponse(200, query.has('from') ? makeLessonList([]) : makeLessonList([oldest], 'next-1')))
    const { result } = renderHook(() => useClassLessons('class-1', true))

    await waitFor(() => expect(result.current.lessons).toHaveLength(1))
    expect(result.current).toMatchObject({ loading: false, error: false, truncated: true, recent: false })
    expect(result.current.lessons[0]!.id).toBe(LESSON_ID)
    expect(queries).toHaveLength(2)
  })

  it('flags a failed second read like a failed first one: no lessons, the form goes on', async () => {
    record((query) => (query.has('from') ? jsonResponse(500, { statusCode: 500, message: 'boom' }) : jsonResponse(200, makeLessonList([oldest], 'next-1'))))
    const { result } = renderHook(() => useClassLessons('class-1', true))

    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current).toMatchObject({ loading: false, lessons: [], truncated: false, recent: false })
  })

  it('starts the window RECENT_LESSONS_DAYS days before the given instant', () => {
    expect(RECENT_LESSONS_DAYS).toBe(30)
    expect(recentLessonsFrom(Date.parse('2026-11-12T12:00:00.000Z'))).toBe('2026-10-13T12:00:00.000Z')
  })

  it('words the hint of each case, for the assignment and the exam forms', () => {
    const whole = { truncated: false, recent: false }
    const firstPage = { truncated: true, recent: false }
    const window = { truncated: true, recent: true }
    expect(lessonSelectHint(whole, t, 'assignments')).toBe(ar.assignments.hints.lesson)
    expect(lessonSelectHint(whole, t, 'exams')).toBe(ar.exams.hints.lesson)
    expect(lessonSelectHint(firstPage, t, 'assignments')).toBe('تُعرض أول 100 درس من دروس الفصل')
    expect(lessonSelectHint(window, t, 'assignments')).toBe('للفصل أكثر من 100 درس: تُعرض دروس آخر 30 يوماً والقادمة (حتى 100)')
    expect(lessonSelectHint(window, t, 'exams')).toBe('للفصل أكثر من 100 درس: تُعرض دروس آخر 30 يوماً والقادمة (حتى 100)')
  })
})
