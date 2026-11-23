// The read behind the learner home's content panel (J-F63): API-230 for the course, then API-231 for a bounded number
// of its lessons, a few at a time. API-231 only reads (opening a lesson is recorded by API-232), so looking at this
// panel never moves the learner's progress. A lesson that fails to load costs its own files, not the panel.
import { getLearningItem, getLearningWorkspace } from '../api/learning'
import type { LearningItem } from '../api/learning'
import { materialLessonsOf, materialsOf } from './learner.materials'
import type { MaterialRow } from './learner.materials'
import { useLoad } from './useLoad'

const PARALLEL_READS = 3

export interface CourseMaterials {
  rows: MaterialRow[]
  /** Lessons whose files could not be read. */
  failed: number
  /** The course has more lessons than the panel reads. */
  truncated: boolean
}

async function readLessons(ids: readonly string[], signal: AbortSignal): Promise<{ lessons: LearningItem[]; failed: number }> {
  const lessons: LearningItem[] = []
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next]!
      next += 1
      try {
        lessons.push(await getLearningItem(id, signal))
      } catch {
        if (signal.aborted) return
        failed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_READS, ids.length) }, worker))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return { lessons, failed }
}

/** The course's books and files; `courseId` null = nothing to read yet. */
export function useCourseMaterials(courseId: string | null) {
  return useLoad<CourseMaterials>(`learner:materials:${courseId}`, courseId !== null, async (signal) => {
    const workspace = await getLearningWorkspace(courseId!, signal)
    const { ids, truncated } = materialLessonsOf(workspace)
    const { lessons, failed } = await readLessons(ids, signal)
    return { rows: materialsOf(workspace, lessons), failed, truncated }
  })
}
