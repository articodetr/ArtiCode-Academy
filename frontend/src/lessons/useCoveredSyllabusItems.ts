// The curriculum lessons a class's sessions already cover (LRN-T06, D-R143),
// for the «next curriculum lesson» suggestion of the lesson form: every page of
// API-093 with the class filter (100 lessons a page, by start time), up to
// COVERAGE_PAGES_MAX pages — a class with more sessions than that gets no
// suggestion rather than a wrong one. One reading per class id, aborted when
// the class changes or the form unmounts. Reading lessons needs `lessons.read`:
// without it (`enabled` false) nothing is asked. A failure answers null too —
// the suggestion is a convenience and never blocks the form.
import { useEffect, useState } from 'react'
import { LESSONS_PAGE_MAX, listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import { coveredSyllabusItems } from './lessons.suggestion'

/** At most 1,000 sessions are read for one class. */
export const COVERAGE_PAGES_MAX = 10

interface CoverageState {
  classId: string | undefined
  covered: ReadonlySet<string> | null
}

async function readCoverage(classId: string, signal: AbortSignal): Promise<ReadonlySet<string> | null> {
  const lessons: Lesson[] = []
  let cursor: string | undefined
  for (let page = 0; page < COVERAGE_PAGES_MAX; page += 1) {
    const list = await listLessons({ classId, order: 'asc', limit: LESSONS_PAGE_MAX, cursor }, signal)
    lessons.push(...list.items)
    if (list.nextCursor === null) return coveredSyllabusItems(lessons)
    cursor = list.nextCursor
  }
  return null
}

/** The syllabus item ids covered by the class's non-cancelled sessions; null while unknown (loading, failed, too many, not allowed). */
export function useCoveredSyllabusItems(classId: string | undefined, enabled: boolean): ReadonlySet<string> | null {
  const [state, setState] = useState<CoverageState>({ classId: undefined, covered: null })
  const wanted = enabled ? classId : undefined

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    readCoverage(wanted, controller.signal)
      .then((covered) => {
        if (!controller.signal.aborted) setState({ classId: wanted, covered })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ classId: wanted, covered: null })
      })
    return () => controller.abort()
  }, [wanted])

  return wanted !== undefined && state.classId === wanted ? state.covered : null
}
