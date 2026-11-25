// The school subjects (PORTAL-04, GET /api/subjects) on the pattern of useLevels.ts: the course form's subject picker
// and the subjects tab of the courses page share one list, so a subject created, renamed, reordered or deleted in the
// tab shows at once in the picker; the learners' catalog reads it for its subject filter. Loading is derived from the
// request key; a failure leaves the last list in place (the picker and the filter still work without it, the server
// validates any subject id). `enabled: false` reads nothing (the courses page of a reader without `courses.manage`
// shows no picker and no tab).
import { useCallback, useEffect, useState } from 'react'
import { listSubjects } from '../api/subjects'
import type { Subject } from '../api/subjects'

export interface SubjectsState {
  subjects: Subject[]
  loading: boolean
  /** The last load failure, or null. */
  error: unknown
  reload: () => void
  /** Replace the list with what the server returned after a write. */
  setSubjects: (subjects: Subject[]) => void
}

export function useSubjects(enabled = true): SubjectsState {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [error, setError] = useState<unknown>(null)
  const [requestKey, setRequestKey] = useState(0)
  const [settledKey, setSettledKey] = useState(-1)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    listSubjects(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setSubjects(result.items)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettledKey(requestKey)
      })
    return () => controller.abort()
  }, [enabled, requestKey])

  const reload = useCallback(() => setRequestKey((key) => key + 1), [])

  return { subjects, loading: enabled && settledKey !== requestKey, error, reload, setSubjects }
}
