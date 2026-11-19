// One course of the public catalog (API-237): read once per course, and again
// on `reload()` after a failure. A newer read aborts the older one; a course of
// another id is never shown while the new one loads.
import { useCallback, useEffect, useState } from 'react'
import { getPublicCourse } from '../api/publicCatalog'
import type { PublicCourseDetail } from '../api/publicCatalog'

interface CourseState {
  key: string
  course: PublicCourseDetail | null
  error: unknown
}

export function usePublicCourse(courseId: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CourseState>({ key: '', course: null, error: null })
  const requestKey = `${courseId}:${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    getPublicCourse(courseId, controller.signal).then(
      (course) => {
        if (!controller.signal.aborted) setState({ key: requestKey, course, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      },
    )
    return () => controller.abort()
  }, [courseId, requestKey])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  const course = state.course && state.course.id === courseId ? state.course : null

  return { course, error: state.key === requestKey ? state.error : null, loading: state.key !== requestKey, reload }
}
