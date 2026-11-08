import { describe, expect, it } from 'vitest'
import { STUDENT_IDS, fourStudents, makeAttendanceItem } from '../test/attendance'
import type { AttendanceDraft } from './attendance.changes'
import {
  changedItems,
  draftOf,
  draftProblem,
  isBatchTooLarge,
  isDraftChanged,
  isRecordableItem,
  markAllPresent,
  normaliseDraft,
  planAttendanceSave,
  unrecordedItems,
  withStatus,
} from './attendance.changes'

const [SARA, YOUSEF, LAYLA, OMAR] = STUDENT_IDS
const draft = (overrides: Partial<AttendanceDraft> = {}): AttendanceDraft => ({ status: 'present', minutesLate: null, note: '', ...overrides })

describe('attendance rules (J-F10)', () => {
  it('records active and completed enrollments only (the server refuses anyone else with not_enrolled)', () => {
    expect(fourStudents().map(isRecordableItem)).toEqual([true, true, false, true])
    expect(isRecordableItem({ enrollmentStatus: null })).toBe(false)
    expect(isRecordableItem({ enrollmentStatus: 'pending' })).toBe(false)
    expect(isRecordableItem({ enrollmentStatus: 'cancelled' })).toBe(false)
  })

  it('starts a row from the server record and normalises what would be stored: minutes with late only, the note trimmed or none', () => {
    const [sara, yousef] = fourStudents()
    expect(draftOf(sara!)).toEqual({ status: undefined, minutesLate: null, note: '' })
    expect(draftOf(yousef!)).toEqual({ status: 'late', minutesLate: 10, note: 'زحمة السير' })
    expect(normaliseDraft(draft({ status: 'absent', minutesLate: 5, note: '  ' }))).toEqual({ status: 'absent', minutesLate: null, note: null })
    expect(normaliseDraft(draft({ status: 'late', minutesLate: 5, note: ' تأخر ' }))).toEqual({ status: 'late', minutesLate: 5, note: 'تأخر' })
  })

  it('sees a change only where the stored record would differ (a padded note or minutes kept off late are no change)', () => {
    const [sara, yousef] = fourStudents()
    expect(isDraftChanged(sara!, draft({ status: undefined }))).toBe(false)
    expect(isDraftChanged(sara!, draft({ status: 'absent' }))).toBe(true)
    expect(isDraftChanged(yousef!, draft({ status: 'late', minutesLate: 10, note: ' زحمة السير ' }))).toBe(false)
    expect(isDraftChanged(yousef!, draft({ status: 'late', minutesLate: 11, note: 'زحمة السير' }))).toBe(true)
    expect(isDraftChanged(yousef!, draft({ status: 'late', minutesLate: 10, note: '' }))).toBe(true)
    expect(isDraftChanged(yousef!, withStatus(draft({ status: 'late', minutesLate: 10, note: 'زحمة السير' }), 'excused'))).toBe(true)
  })

  it('plans ONE batch of the changed recordable rows, each as its whole record, and nothing when no row changed', () => {
    const items = fourStudents()
    expect(planAttendanceSave(items, new Map())).toBeNull()
    expect(planAttendanceSave(items, new Map([[YOUSEF, draft({ status: 'late', minutesLate: 10, note: 'زحمة السير' })]]))).toBeNull()

    const drafts = new Map<string, AttendanceDraft>([
      [OMAR, draft({ status: 'excused', note: ' مرض ' })],
      [YOUSEF, draft({ status: 'present', minutesLate: 10, note: '' })],
      [SARA, draft({ status: 'late', minutesLate: 5 })],
      // A withdrawn student is never sent, whatever the draft says.
      [LAYLA, draft({ status: 'absent' })],
    ])
    expect(planAttendanceSave(items, drafts)).toEqual({
      records: [
        { studentId: SARA, status: 'late', minutesLate: 5 },
        // Leaving late drops the minutes and the emptied note: both are cleared on the server.
        { studentId: YOUSEF, status: 'present' },
        { studentId: OMAR, status: 'excused', note: 'مرض' },
      ],
    })
    expect(changedItems(items, drafts).map((item) => item.student.id)).toEqual([SARA, YOUSEF, OMAR])
  })

  it('marks the unrecorded rows present and leaves recorded, chosen and read-only rows alone', () => {
    const items = fourStudents()
    expect(unrecordedItems(items, new Map()).map((item) => item.student.id)).toEqual([SARA, OMAR])
    const chosen = new Map<string, AttendanceDraft>([[OMAR, draft({ status: 'absent' })]])
    const marked = markAllPresent(items, chosen)
    expect(marked.get(SARA)).toEqual({ status: 'present', minutesLate: null, note: '' })
    expect(marked.get(OMAR)).toEqual(draft({ status: 'absent' }))
    expect(marked.has(YOUSEF)).toBe(false)
    expect(marked.has(LAYLA)).toBe(false)
    expect(unrecordedItems(items, marked)).toEqual([])
  })

  it('mirrors the DTO rules locally: minutes 1–720 whole with late, a note up to 500 characters, at most 500 records', () => {
    expect(draftProblem(draft({ status: 'late', minutesLate: 1 }))).toBeNull()
    expect(draftProblem(draft({ status: 'late', minutesLate: 720 }))).toBeNull()
    expect(draftProblem(draft({ status: 'late', minutesLate: null }))).toBeNull()
    expect(draftProblem(draft({ status: 'late', minutesLate: 0 }))).toBe('minutes_invalid')
    expect(draftProblem(draft({ status: 'late', minutesLate: 721 }))).toBe('minutes_invalid')
    expect(draftProblem(draft({ status: 'late', minutesLate: 2.5 }))).toBe('minutes_invalid')
    // Minutes kept on another status are dropped, not refused.
    expect(draftProblem(draft({ status: 'absent', minutesLate: 0 }))).toBeNull()
    expect(draftProblem(draft({ note: 'ن'.repeat(500) }))).toBeNull()
    expect(draftProblem(draft({ note: 'ن'.repeat(501) }))).toBe('note_too_long')
    const many = Array.from({ length: 501 }, (_, index) => ({ studentId: `s-${index}`, status: 'present' as const }))
    expect(isBatchTooLarge({ records: many })).toBe(true)
    expect(isBatchTooLarge({ records: many.slice(1) })).toBe(false)
    expect(isRecordableItem(makeAttendanceItem({ enrollmentStatus: 'completed' }))).toBe(true)
  })
})
