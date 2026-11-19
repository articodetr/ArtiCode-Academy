// The curriculum of one course for the author's preview (MOD-20 — D-R144):
// API-226 read once when the preview opens and kept while the author moves
// between its lessons, read again only on «try again». Reading needs
// `courses.manage` or teaching a class of the course; anyone else gets 404.
// Nothing else is read or written: the preview never calls API-229..234.
import { useCallback, useEffect, useState } from 'react'
import { getCurriculum } from '../api/curriculum'
import type { Curriculum } from '../api/curriculum'

interface State {
  key: string
  curriculum: Curriculum | null
  error: unknown
}

export interface CurriculumPreviewReading {
  curriculum: Curriculum | null
  loading: boolean
  error: unknown
  reload: () => void
}

export function useCurriculumPreview(courseId: string): CurriculumPreviewReading {
  const [tick, setTick] = useState(0)
  const requestKey = `${courseId}#${tick}`
  const [state, setState] = useState<State>({ key: '', curriculum: null, error: null })

  useEffect(() => {
    if (!courseId) return
    const controller = new AbortController()
    getCurriculum(courseId, controller.signal).then(
      (curriculum) => {
        if (!controller.signal.aborted) setState({ key: requestKey, curriculum, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key: requestKey, curriculum: null, error })
      },
    )
    return () => controller.abort()
  }, [courseId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const settled = state.key === requestKey
  return { curriculum: settled ? state.curriculum : null, loading: !settled, error: settled ? state.error : null, reload }
}
