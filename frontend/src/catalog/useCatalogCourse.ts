// One course of the catalog (API-220), read again after every enrollment
// attempt: `reload()` asks the server; a newer read aborts the older one.
// Loading is derived from the request key; a failed re-read keeps the last
// course on screen behind the error.
import { useCallback, useEffect, useState } from 'react'
import { getCatalogCourse } from '../api/catalog'
import type { CatalogCourseDetail } from '../api/catalog'

interface CourseState {
  key: string
  course: CatalogCourseDetail | null
  error: unknown
}

export function useCatalogCourse(courseId: string) {
  const [reloadTick, setReloadTick] = useState(0)
  const [state, setState] = useState<CourseState>({ key: '', course: null, error: null })
  const requestKey = `${courseId}:${reloadTick}`

  useEffect(() => {
    const controller = new AbortController()
    getCatalogCourse(courseId, controller.signal)
      .then((course) => {
        if (!controller.signal.aborted) setState({ key: requestKey, course, error: null })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((current) => ({ ...current, key: requestKey, error }))
      })
    return () => controller.abort()
  }, [courseId, requestKey])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])
  // A course of another id is never shown while the new one loads.
  const course = state.course && state.course.id === courseId ? state.course : null

  return { course, error: state.error, loading: state.key !== requestKey, reload }
}
