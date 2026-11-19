// One lesson of the course player (API-231) and the record that it was opened
// (API-232). Reading a lesson writes nothing; once a read has answered, the
// visit is posted exactly once for that opening — opening the same lesson
// again later (A → B → A) is another opening, a retry after a failed read is
// the first. Opening never completes a lesson (D-R134). The progress shown is
// replaced only by the server's answers (setProgress), never computed here.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearningItem, visitLearningItem } from '../api/learning'
import type { ItemProgress, LearningItem } from '../api/learning'
import { isLessonGone } from './learn.errors'
import { mergeProgress } from './learn.state'

interface State {
  key: string
  item: LearningItem | null
  error: unknown
}

export interface LearningItemCallbacks {
  /** The visit's answer (API-232) — the sidebar shows the lesson as started. */
  onVisited?: (itemId: string, progress: ItemProgress) => void
  /** API-231 answered 404: the lesson is unknown, unpublished or of another course. */
  onGone?: (itemId: string) => void
}

export interface LearningItemReading {
  item: LearningItem | null
  loading: boolean
  error: unknown
  retry: () => void
  /** Carries a progress answer of the server into the lesson on screen (ignored for another lesson). */
  setProgress: (itemId: string, progress: ItemProgress) => void
}

export function useLearningItem(itemId: string | undefined, callbacks: LearningItemCallbacks = {}): LearningItemReading {
  const [tick, setTick] = useState(0)
  const requestKey = `${itemId ?? ''}#${tick}`
  const [state, setState] = useState<State>({ key: '', item: null, error: null })
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  useEffect(() => {
    if (!itemId) return
    const controller = new AbortController()
    getLearningItem(itemId, controller.signal).then(
      (item) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, item, error: null })
        // This opening is recorded once; a failed visit is not the learner's concern (the next opening records it).
        visitLearningItem(item.id).then(
          ({ progress }) => {
            setState((previous) =>
              previous.item?.id === item.id ? { ...previous, item: { ...previous.item, progress: mergeProgress(previous.item.progress, progress) } } : previous,
            )
            callbacksRef.current.onVisited?.(item.id, progress)
          },
          () => undefined,
        )
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ key: requestKey, item: null, error })
        if (isLessonGone(error)) callbacksRef.current.onGone?.(itemId)
      },
    )
    return () => controller.abort()
  }, [itemId, requestKey])

  const retry = useCallback(() => setTick((value) => value + 1), [])
  const setProgress = useCallback((id: string, progress: ItemProgress) => {
    setState((previous) =>
      previous.item?.id === id ? { ...previous, item: { ...previous.item, progress: mergeProgress(previous.item.progress, progress) } } : previous,
    )
  }, [])

  const settled = state.key === requestKey
  return {
    item: settled ? state.item : null,
    loading: Boolean(itemId) && !settled,
    error: settled ? state.error : null,
    retry,
    setProgress,
  }
}
