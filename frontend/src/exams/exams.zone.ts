// The zone an exam's date is typed in (J-F45, D-R41). The server gives an exam
// the same zone as an assignment — the linked lesson's room branch when the
// branch has one, else the academy's (`displayTimeZone()` in ExamsService) —
// so the rules are dueZoneOf()'s of assignments/assignments.zone.ts:
//
//   1. an existing exam whose lesson link the form keeps: its `timeZone`;
//   2. a lesson chosen in the form: that lesson's `timeZone` from the API-093
//      list the lesson select has already read;
//   3. no lesson, or a lesson whose zone is unknown: the academy's zone;
//   4. the academy could not be read: this device's zone, which the hint says.
//
// The wall-clock conversions and the list filter's day bounds are the
// assignments' too (wallClockIn(), instantIn(), dayStartIn(), dayEndIn()). Pure;
// unit-tested in exams.zone.test.ts.
import { dueZoneOf } from '../assignments/assignments.zone'
import type { DueZoneInput } from '../assignments/assignments.zone'

/** Where the form's zone comes from — the hint words each one (`exams.zone.*`). */
export type ExamZoneSource = 'exam' | 'lesson' | 'academy' | 'device'

export interface ExamZone {
  zone: string
  source: ExamZoneSource
}

export type ExamZoneInput = DueZoneInput

/** The zone the form's exam date is typed in: the zone the server will give the exam (rules 1–4 above). */
export function examZoneOf(input: ExamZoneInput): ExamZone {
  const { zone, source } = dueZoneOf(input)
  return { zone, source: source === 'assignment' ? 'exam' : source }
}
