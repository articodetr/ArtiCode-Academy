// The syllabus of a course (API-048) for the syllabus item select of the
// lesson forms (J-F09): one request per course id, aborted when the course
// changes or the form unmounts; a failure (a course the caller may not read)
// leaves the select empty and flagged, never blocks the form.
import { useEffect, useState } from 'react'
import { getSyllabus } from '../api/syllabus'
import type { SyllabusItem } from '../api/syllabus'

interface SyllabusState {
  courseId: string | undefined
  items: SyllabusItem[]
  error: boolean
}

export function useSyllabusItems(courseId: string | undefined): { items: SyllabusItem[]; loading: boolean; error: boolean } {
  const [state, setState] = useState<SyllabusState>({ courseId: undefined, items: [], error: false })

  useEffect(() => {
    if (!courseId) return
    const controller = new AbortController()
    getSyllabus(courseId, controller.signal)
      .then((syllabus) => {
        if (!controller.signal.aborted) setState({ courseId, items: syllabus.items, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ courseId, items: [], error: true })
      })
    return () => controller.abort()
  }, [courseId])

  const loaded = state.courseId === courseId
  return { items: loaded ? state.items : [], loading: Boolean(courseId) && !loaded, error: loaded && state.error }
}
