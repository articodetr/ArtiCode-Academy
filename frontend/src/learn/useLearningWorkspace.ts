// The workspace of one course (API-230) for the course player (MOD-20). It is
// read once when the course opens and kept while the learner moves between
// its lessons (the route changes, the workspace does not); the answers of the
// progress writes are carried into it at once (update), and it is read again
// in the background after a completion (reload) — the screen keeps showing
// the last workspace while that read runs, so nothing flickers.
import { useCallback, useEffect, useState } from 'react'
import { getLearningWorkspace } from '../api/learning'
import type { LearningState, LearningWorkspace } from '../api/learning'

interface State {
  /** The request this state answers (course + reload counter). */
  key: string
  courseId: string
  workspace: LearningWorkspace | null
  error: unknown
}

export interface WorkspaceReading {
  /** The course's workspace, or null before the first answer (and after a failed first read). */
  workspace: LearningWorkspace | null
  /** True while the first read of this course runs (a background reload keeps the workspace and is not «loading»). */
  loading: boolean
  /** True once the latest request has answered (a fresh workspace, or its failure). */
  settled: boolean
  /** The failure of the latest read; shown only when no workspace is on screen. */
  error: unknown
  /** Reads the workspace again (the current one stays on screen meanwhile). */
  reload: () => void
  /** Applies an answer of the server to the workspace on screen. */
  update: (change: (workspace: LearningWorkspace) => LearningWorkspace) => void
}

const STATE_RANK: Readonly<Record<LearningState, number>> = { not_started: 0, in_progress: 1, completed: 2 }

/**
 * A fresh read that answers after a local update may predate it (it was sent
 * before the write landed): a lesson the screen already shows further along
 * keeps its state — the server never moves a lesson back (D-R134).
 */
function keepForward(previous: LearningWorkspace | null, next: LearningWorkspace): LearningWorkspace {
  if (!previous) return next
  const shown = new Map(previous.sections.flatMap((section) => section.items.map((item) => [item.id, item] as const)))
  return {
    ...next,
    sections: next.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const before = shown.get(item.id)
        return before && STATE_RANK[before.state] > STATE_RANK[item.state] ? { ...item, state: before.state, completedAt: before.completedAt } : item
      }),
    })),
  }
}

export function useLearningWorkspace(courseId: string): WorkspaceReading {
  const [tick, setTick] = useState(0)
  const requestKey = `${courseId}#${tick}`
  const [state, setState] = useState<State>({ key: '', courseId: '', workspace: null, error: null })

  useEffect(() => {
    if (!courseId) return
    const controller = new AbortController()
    getLearningWorkspace(courseId, controller.signal).then(
      (workspace) => {
        if (controller.signal.aborted) return
        setState((previous) => ({
          key: requestKey,
          courseId,
          workspace: keepForward(previous.courseId === courseId ? previous.workspace : null, workspace),
          error: null,
        }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((previous) => ({ key: requestKey, courseId, workspace: previous.courseId === courseId ? previous.workspace : null, error }))
      },
    )
    return () => controller.abort()
  }, [courseId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  const update = useCallback((change: (workspace: LearningWorkspace) => LearningWorkspace) => {
    setState((previous) => (previous.workspace ? { ...previous, workspace: change(previous.workspace) } : previous))
  }, [])

  const workspace = state.courseId === courseId ? state.workspace : null
  const settled = state.key === requestKey
  return {
    workspace,
    loading: workspace === null && !settled,
    settled,
    error: settled ? state.error : null,
    reload,
    update,
  }
}
