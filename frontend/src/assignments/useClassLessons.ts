// The lessons of one class for the lesson select of the assignment forms
// (J-F38) and of the exam forms (J-F45): API-093 by `classId` and start time,
// one read per class id, aborted when the class changes or the form unmounts.
// A class that fits one page (the 100 lessons a page holds at most) is offered
// whole. A longer class (J-F56, the owner's note 2 on #87) is read a second
// time from RECENT_LESSONS_DAYS days ago on: its first page would hold only its
// oldest lessons and drop the recent and coming ones, the lessons an
// assignment or an exam is usually linked to (`recent` says so; a class whose
// lessons all lie further back keeps its first page). `truncated` says the
// class has more lessons than the select offers. Reading lessons needs
// `lessons.read`: without it (`enabled` false) nothing is asked and the select
// stays empty. A failure leaves the select empty and flagged, never blocks the
// form (the lesson is optional).
import { useEffect, useState } from 'react'
import { LESSONS_PAGE_MAX, listLessons } from '../api/lessons'
import type { Lesson } from '../api/lessons'
import type { Translate } from '../users/users.format'

/** How far back the select of a class longer than one page reaches. */
export const RECENT_LESSONS_DAYS = 30

const DAY_MS = 86_400_000

/** The start of that window: RECENT_LESSONS_DAYS days before `now` (an instant — no zone is needed for «a month back»). */
export function recentLessonsFrom(now: number = Date.now()): string {
  return new Date(now - RECENT_LESSONS_DAYS * DAY_MS).toISOString()
}

interface OfferedLessons {
  lessons: Lesson[]
  truncated: boolean
  recent: boolean
}

interface ClassLessonsState extends OfferedLessons {
  classId: string | undefined
  error: boolean
}

export interface ClassLessons {
  lessons: Lesson[]
  loading: boolean
  error: boolean
  /** The class has more lessons than the select offers. */
  truncated: boolean
  /** The class is longer than one page: the select offers its lessons from RECENT_LESSONS_DAYS days ago on. */
  recent: boolean
}

/** The hint under a lesson select (`assignments.hints.*` or `exams.hints.*`): which lessons of the class it offers. */
export function lessonSelectHint(lessons: Pick<ClassLessons, 'truncated' | 'recent'>, t: Translate, block: 'assignments' | 'exams'): string {
  if (lessons.recent) return t(`${block}.hints.lessonsRecent`, { count: LESSONS_PAGE_MAX, days: RECENT_LESSONS_DAYS })
  if (lessons.truncated) return t(`${block}.hints.lessonsTruncated`, { count: LESSONS_PAGE_MAX })
  return t(`${block}.hints.lesson`)
}

/** The lessons the select offers for one class (one read, or two for a class longer than a page). */
async function offeredLessons(classId: string, signal: AbortSignal): Promise<OfferedLessons> {
  const first = await listLessons({ classId, order: 'asc', limit: LESSONS_PAGE_MAX }, signal)
  if (first.nextCursor === null) return { lessons: first.items, truncated: false, recent: false }
  const recent = await listLessons({ classId, order: 'asc', from: recentLessonsFrom(), limit: LESSONS_PAGE_MAX }, signal)
  if (recent.items.length === 0) return { lessons: first.items, truncated: true, recent: false }
  return { lessons: recent.items, truncated: true, recent: true }
}

const NOTHING: ClassLessonsState = { classId: undefined, lessons: [], truncated: false, recent: false, error: false }

export function useClassLessons(classId: string | undefined, enabled: boolean): ClassLessons {
  const [state, setState] = useState<ClassLessonsState>(NOTHING)
  const wanted = enabled ? classId : undefined

  useEffect(() => {
    if (!wanted) return
    const controller = new AbortController()
    offeredLessons(wanted, controller.signal)
      .then((offered) => {
        if (!controller.signal.aborted) setState({ classId: wanted, ...offered, error: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ ...NOTHING, classId: wanted, error: true })
      })
    return () => controller.abort()
  }, [wanted])

  const loaded = wanted !== undefined && state.classId === wanted
  return {
    lessons: loaded ? state.lessons : [],
    loading: wanted !== undefined && !loaded,
    error: loaded && state.error,
    truncated: loaded && state.truncated,
    recent: loaded && state.recent,
  }
}
