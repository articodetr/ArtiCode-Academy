// What «الاختبارات والشهادة» of «دروسي» shows for one course (J-F67): where the
// student stands on the way to their certificate (API-070) and the class's exams
// (API-121, with the moment each attempt's countdown arrived — takeExam.clock).
// Read again when the course's completed lessons change and after a claim; the
// last answer stays on screen meanwhile, so nothing flickers.
import { useCallback, useEffect, useState } from 'react'
import { getEnrollmentCompletion } from '../../api/myCertificates'
import type { EnrollmentCompletion } from '../../api/myCertificates'
import { listMyExams } from '../../api/myExams'
import type { MyExamItem } from '../../api/myExams'
import { markArrival, monotonicNow } from '../../takeExam/takeExam.clock'

/** A class holds few exams: one page is all of them. */
const EXAMS_LIMIT = 50

export interface HubCompletionData {
  completion: EnrollmentCompletion
  exams: MyExamItem[]
}

interface State {
  key: string
  data: HubCompletionData | null
  error: unknown
}

export interface HubCompletionReading {
  data: HubCompletionData | null
  /** True until the first answer. */
  loading: boolean
  /** The failure of the latest read. */
  error: unknown
  reload: () => void
}

export function useHubCompletion(enrollmentId: string, classId: string, studentId: string, version: number): HubCompletionReading {
  const [tick, setTick] = useState(0)
  const requestKey = `${enrollmentId}#${version}#${tick}`
  const [state, setState] = useState<State>({ key: '', data: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([getEnrollmentCompletion(enrollmentId, controller.signal), listMyExams({ classId, studentId, order: 'asc', limit: EXAMS_LIMIT }, controller.signal)]).then(
      ([completion, page]) => {
        if (controller.signal.aborted) return
        const arrivedAt = monotonicNow()
        for (const item of page.items) if (item.online?.inProgress) markArrival(item.online.inProgress, arrivedAt)
        setState({ key: requestKey, data: { completion, exams: page.items }, error: null })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((previous) => ({ key: requestKey, data: previous.data, error }))
      },
    )
    return () => controller.abort()
  }, [enrollmentId, classId, studentId, requestKey])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data: state.data, loading: state.data === null && state.key !== requestKey, error: state.key === requestKey ? state.error : null, reload }
}
