// J-F81: every class lesson (MOD-06) of the learner's classes from API-101 — newest first, read page by page — for
// «دوراتي»: the cards count them and the course panel under the cards lists them, so a lesson a teacher adds reaches
// the student without a curriculum lesson (MOD-20) behind it. Ownership, no key: the server lists the lessons of
// `active`/`completed` enrollments only (a guardian's children's too). The read stops after MAX_PAGES pages
// (`truncated`); a reload keeps the previous lessons on screen until the new answer arrives.
import { useCallback, useEffect, useState } from 'react'
import { listMyLessons } from '../api/myLessons'
import type { MyLessonItem } from '../api/myLessons'

/** API-101's largest page. */
export const LEARNER_LESSONS_PAGE_SIZE = 100
/** At most 1,000 lessons — far more than a learner's classes hold. */
export const LEARNER_LESSONS_MAX_PAGES = 10

export interface LearnerClassLessons {
  /** The lessons as last read, newest first; [] before the first answer and after a failed first read. */
  items: readonly MyLessonItem[]
  /** A read is on its way. */
  loading: boolean
  /** The last read failed. */
  failed: boolean
  /** The read stopped at the page cap: a count is a lower bound. */
  truncated: boolean
  /** True once a read has answered (successfully or not). */
  settled: boolean
  reload: () => void
}

interface Result {
  attempt: number
  items: readonly MyLessonItem[]
  failed: boolean
  truncated: boolean
}

async function readAll(signal: AbortSignal): Promise<{ items: MyLessonItem[]; truncated: boolean }> {
  const items: MyLessonItem[] = []
  let cursor: string | undefined
  for (let page = 0; page < LEARNER_LESSONS_MAX_PAGES; page += 1) {
    const list = await listMyLessons({ order: 'desc', limit: LEARNER_LESSONS_PAGE_SIZE, cursor }, signal)
    items.push(...list.items)
    if (!list.nextCursor) return { items, truncated: false }
    cursor = list.nextCursor
  }
  return { items, truncated: true }
}

export function useLearnerClassLessons(): LearnerClassLessons {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    readAll(controller.signal).then(
      ({ items, truncated }) => {
        if (!controller.signal.aborted) setResult({ attempt, items, failed: false, truncated })
      },
      () => {
        if (!controller.signal.aborted) setResult((previous) => ({ attempt, items: previous?.items ?? [], failed: true, truncated: previous?.truncated ?? false }))
      },
    )
    return () => controller.abort()
  }, [attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    items: result?.items ?? [],
    loading: result?.attempt !== attempt,
    failed: result?.failed ?? false,
    truncated: result?.truncated ?? false,
    settled: result !== null,
    reload,
  }
}
