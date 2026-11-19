// The reads of «My School» (MOD-20): each source on its own, so one failure
// never hides the others and each panel offers its own «try again».
// - API-229 «my learning» — every owned enrollment with the server's progress.
// - API-112 «my assignments» with `pending=true` — what waits for its student.
// - API-121 «my exams» — the scheduled ones from now on.
// The certificates (API-135) reuse useMyCertificates() of the certificates
// screens and the requests (API-222) useMyRequests() of MOD-19.
import { useState, useSyncExternalStore } from 'react'
import { getMyLearning } from '../api/learning'
import type { MyLearningCourse } from '../api/learning'
import { listMyAssignments } from '../api/myAssignments'
import type { MyAssignmentItem } from '../api/myAssignments'
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { useLoad } from '../dashboard/useLoad'

/** How many waiting assignments and upcoming exams the compact lists show; the rest is on their own pages. */
export const ASSESSMENTS_LIMIT = 10

export interface FirstPage<T> {
  items: T[]
  /** More exist beyond the first page. */
  more: boolean
}

/** API-229 */
export function useMyLearning() {
  return useLoad<MyLearningCourse[]>('mySchool:learning', true, (signal) => getMyLearning(signal).then((answer) => answer.items))
}

/** API-112 `pending=true`: the open assignments still waiting for their student, soonest due first. Read once `enabled`. */
export function usePendingAssignments(enabled: boolean) {
  return useLoad<FirstPage<MyAssignmentItem>>('mySchool:assignments', enabled, (signal) =>
    listMyAssignments({ pending: true, status: 'open', order: 'asc', limit: ASSESSMENTS_LIMIT }, signal).then((answer) => ({ items: answer.items, more: answer.nextCursor !== null })),
  )
}

/** API-121: the scheduled exams from the moment the page opened, soonest first. Read once `enabled`. */
export function useUpcomingExams(enabled: boolean) {
  // The instant is fixed for the page's life, so a re-render never asks again.
  const [from] = useState(() => new Date().toISOString())
  return useLoad<FirstPage<MyExamItem>>(`mySchool:exams:${from}`, enabled, (signal) =>
    listMyExams({ status: 'scheduled', from, order: 'asc', limit: ASSESSMENTS_LIMIT }, signal).then((answer) => ({ items: answer.items, more: answer.nextCursor !== null })),
  )
}

/** Below antd's `md` breakpoint (the timetable's query). */
const PHONE_QUERY = '(max-width: 767.98px)'

function subscribeToViewport(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}

function isPhoneViewport(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

/** True on a phone-sized viewport, known from the first render: the sections become a bar above the content. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribeToViewport, isPhoneViewport, () => false)
}
