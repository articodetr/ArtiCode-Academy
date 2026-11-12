// The roster of one class for the new-invoice form (J-F52): API-057
// (`enrollments.read` with `enrollments.manage` or an assigned teacher — the
// server decides), every enrollment whatever its status (an invoice may be tied
// to any enrollment of the student — the server checks only that it is theirs),
// page after page up to ROSTER_PAGES_MAX. Read again when the class changes;
// stale answers are dropped.
import { useEffect, useState } from 'react'
import { listEnrollments } from '../api/enrollments'
import type { Enrollment } from '../api/enrollments'

const ROSTER_PAGE_SIZE = 100
/** 10 pages of 100: far beyond any class's capacity. */
const ROSTER_PAGES_MAX = 10

interface RosterState {
  classId: string | null
  items: Enrollment[]
  error: unknown
}

async function readRoster(classId: string, signal: AbortSignal): Promise<Enrollment[]> {
  const items: Enrollment[] = []
  let cursor: string | undefined
  for (let page = 0; page < ROSTER_PAGES_MAX; page += 1) {
    const list = await listEnrollments(classId, { limit: ROSTER_PAGE_SIZE, cursor }, signal)
    items.push(...list.items)
    if (!list.nextCursor) break
    cursor = list.nextCursor
  }
  return items
}

export function useClassRoster(classId: string | undefined) {
  const [state, setState] = useState<RosterState>({ classId: null, items: [], error: null })

  useEffect(() => {
    if (!classId) return
    const controller = new AbortController()
    readRoster(classId, controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setState({ classId, items, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ classId, items: [], error })
      },
    )
    return () => controller.abort()
  }, [classId])

  const current = classId !== undefined && state.classId === classId
  return { items: current ? state.items : [], error: current ? state.error : null, loading: classId !== undefined && !current }
}
