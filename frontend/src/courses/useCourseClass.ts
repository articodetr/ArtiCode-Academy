// The course's classes for the course drawer's class tabs, and the one the tabs
// work on (courses.classScope.ts decides). One reading shared by every class
// tab: it starts when the drawer asks (the first time a class tab opens, and
// again each time one opens after another tab — the «فتح الاشتراك» panel of the
// details tab may have just created the general class), never on its own. A
// re-read keeps the classes on screen until it answers, so an editor holding
// unsaved work in a tab is never unmounted by it. The state belongs to one
// course: another course id (or null once the drawer closes) starts empty.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AcademyClass } from '../api/classes'
import type { Course } from '../api/courses'
import { prepareCourseClass, readCourseClasses } from './courseClasses'
import type { PrepareOutcome } from './courseClasses'
import { classChoices, resolveSelectedClass, showsClassSelector } from './courses.classScope'

/** Why the last «تجهيز الدورة» press did not prepare the course: an outcome of the plan, or the server's refusal. */
export type PrepareFailure = { kind: 'unpublished' } | { kind: 'codes_exhausted' } | { kind: 'error'; error: unknown }

interface ScopeState {
  courseId: string | null
  /** Null until the first answer. */
  classes: AcademyClass[] | null
  /** The last read failed (the classes of an earlier read, if any, stay). */
  failed: boolean
  /** The admin's choice in the selector, or null for the default pick. */
  chosenId: string | null
  prepareFailure: PrepareFailure | null
}

const EMPTY: Omit<ScopeState, 'courseId'> = { classes: null, failed: false, chosenId: null, prepareFailure: null }

export interface CourseClassScope {
  classes: AcademyClass[] | null
  failed: boolean
  /** The class the tabs work on, or null when the course has none to offer. */
  selected: AcademyClass | null
  /** The selector's options, in its order. */
  choices: AcademyClass[]
  showSelector: boolean
  /** Moved by `retry()`: an opened students tab reads its roster again with the classes (KI-120). */
  rosterRefresh: number
  preparing: boolean
  prepareFailure: PrepareFailure | null
  select: (classId: string) => void
  /** Reads the course's classes again; never rejects (a failure shows through `failed`). */
  refresh: () => Promise<void>
  /** The retry of a failed read: the classes, and the roster of an opened students tab with them. */
  retry: () => void
  /** A class the server returned after a write in one of the tabs. */
  replace: (cls: AcademyClass) => void
  /** «تجهيز الدورة للمدرسين والطلاب»; null when a press is already running. Ends with a fresh read. */
  prepare: (course: Pick<Course, 'id' | 'code' | 'status'>, startsOn: string) => Promise<PrepareOutcome | 'failed' | null>
  dismissPrepareFailure: () => void
}

export function useCourseClass(courseId: string | null): CourseClassScope {
  const [state, setState] = useState<ScopeState>({ courseId, ...EMPTY })
  const [rosterRefresh, setRosterRefresh] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const reading = useRef<AbortController | null>(null)
  // Set before the first await, so a second press in the same tick cannot start a second write.
  const writing = useRef(false)

  // Another course (or none): what the state holds belongs to the previous one.
  const current: ScopeState = state.courseId === courseId ? state : { courseId, ...EMPTY }

  // A read of the previous course must never land on this one.
  useEffect(() => () => reading.current?.abort(), [courseId])

  /** Applies `change` to this course's state, starting it empty when it held another course. */
  const update = useCallback(
    (change: (scope: ScopeState) => ScopeState) => setState((previous) => change(previous.courseId === courseId ? previous : { courseId, ...EMPTY })),
    [courseId],
  )

  const refresh = useCallback((): Promise<void> => {
    reading.current?.abort()
    if (courseId === null) return Promise.resolve()
    const controller = new AbortController()
    reading.current = controller
    return readCourseClasses(courseId, controller.signal).then(
      (classes) => {
        if (controller.signal.aborted) return
        update((scope) => ({ ...scope, classes, failed: false }))
      },
      () => {
        if (controller.signal.aborted) return
        update((scope) => ({ ...scope, failed: true }))
      },
    )
  }, [courseId, update])

  const retry = useCallback(() => {
    setRosterRefresh((count) => count + 1)
    void refresh()
  }, [refresh])

  const replace = useCallback(
    (cls: AcademyClass) => {
      // The write's answer is newer than any read still in flight.
      reading.current?.abort()
      update((scope) => (scope.classes ? { ...scope, classes: scope.classes.map((klass) => (klass.id === cls.id ? cls : klass)) } : scope))
    },
    [update],
  )

  const select = useCallback((classId: string) => update((scope) => ({ ...scope, chosenId: classId })), [update])

  const dismissPrepareFailure = useCallback(() => update((scope) => ({ ...scope, prepareFailure: null })), [update])

  const prepare = useCallback(
    async (course: Pick<Course, 'id' | 'code' | 'status'>, startsOn: string): Promise<PrepareOutcome | 'failed' | null> => {
      if (writing.current) return null
      writing.current = true
      setPreparing(true)
      update((scope) => ({ ...scope, prepareFailure: null }))
      let result: PrepareOutcome | 'failed'
      let failure: PrepareFailure | null = null
      try {
        result = await prepareCourseClass(course, startsOn)
        if (result === 'unpublished') failure = { kind: 'unpublished' }
        else if (result === 'codes_exhausted') failure = { kind: 'codes_exhausted' }
      } catch (error) {
        result = 'failed'
        failure = { kind: 'error', error }
      }
      // The class the press prepared (or left half way) is the default pick: drop an earlier choice.
      update((scope) => ({ ...scope, chosenId: null, prepareFailure: failure }))
      await refresh()
      writing.current = false
      setPreparing(false)
      return result
    },
    [refresh, update],
  )

  const { classes, chosenId } = current
  const derived = useMemo(
    () => ({
      selected: classes ? resolveSelectedClass(classes, chosenId) : null,
      choices: classes ? classChoices(classes) : [],
      showSelector: classes ? showsClassSelector(classes) : false,
    }),
    [classes, chosenId],
  )

  return {
    classes,
    failed: current.failed,
    ...derived,
    rosterRefresh,
    preparing,
    prepareFailure: current.prepareFailure,
    select,
    refresh,
    retry,
    replace,
    prepare,
    dismissPrepareFailure,
  }
}
