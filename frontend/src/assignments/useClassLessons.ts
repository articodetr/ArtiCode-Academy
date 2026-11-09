// The lessons of one class for the lesson select of the assignment forms
// (J-F38): one page of API-093 (`classId`, by start time, the 100 lessons a
// page holds at most — `truncated` says the class has more), one request per
// class id, aborted when the class changes or the form unmounts. Reading
// lessons needs `lessons.read`: without it (`enabled` false) nothing is asked
// and the select stays empty. A failure leaves the select empty and flagged,
// never blocks the form (the lesson is optional).
import { useEffect, useState } from 'react'
import { LESSONS_PAGE_MAX, listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'

interface ClassLessonsState {
  classId: string | undefined
  lessons: Lesson[]
  truncated: boolean
  error: boolean
}

export interface ClassLessons {
  lessons: Lesson[]
  loading: boolean
  error: boolean
  /** The class has more lessons than the page holds. */
  truncated: boolean
}

export function useClassLessons(classId: string | undefined, enabled: boolean): ClassLessons {
  const [state, setState] = useState<ClassLessonsState>({ classId: undefined, lessons: [], truncated: false, error: false })
  const wanted = enabled ? classId : undefined

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    listLessons({ classId: wanted, order: 'asc', limit: LESSONS_PAGE_MAX }, controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) setState({ classId: wanted, lessons: list.items, truncated: list.nextCursor !== null, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ classId: wanted, lessons: [], truncated: false, error: true })
      })
    return () => controller.abort()
  }, [wanted])

  const loaded = wanted !== undefined && state.classId === wanted
  return {
    lessons: loaded ? state.lessons : [],
    loading: wanted !== undefined && !loaded,
    error: loaded && state.error,
    truncated: loaded && state.truncated,
  }
}
