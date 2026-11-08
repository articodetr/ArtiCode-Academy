// Pure rules of the attendance sheet (J-F10), unit-tested in
// attendance.changes.test.ts. A draft is what the editor shows for one
// student; the save plan sends ONE PUT (API-100) with the rows whose draft
// differs from the server's record — each as the WHOLE new state of that
// record, so a minutesLate or a note left out is cleared on the server —
// and nothing when no row changed. Local rules mirror
// backend/src/lessons/attendance.{dto,changes}.ts; the server decides.
import { ATTENDANCE_BATCH_MAX, ATTENDANCE_NOTE_MAX_LENGTH, MINUTES_LATE_MAX, RECORDABLE_ENROLLMENT_STATUSES } from '../api/attendance'
import type { AttendanceItem, AttendanceRecordInput, AttendanceStatus, RecordAttendanceInput } from '../api/attendance'

/** One row of the editor. `status` undefined = not recorded yet (and not chosen). */
export interface AttendanceDraft {
  status: AttendanceStatus | undefined
  /** Whole minutes; kept for `late` only. */
  minutesLate: number | null
  note: string
}

/** Drafts the user touched, by student id; the other rows show the server's record. */
export type AttendanceDrafts = ReadonlyMap<string, AttendanceDraft>

/** Why a draft cannot be sent: minutes outside 1–720 (or not whole), or a note too long. */
export type DraftProblem = 'minutes_invalid' | 'note_too_long'

/** True when the student may be recorded: an active or completed enrollment (anyone else is refused with `not_enrolled`). */
export function isRecordableItem(item: Pick<AttendanceItem, 'enrollmentStatus'>): boolean {
  return item.enrollmentStatus !== null && RECORDABLE_ENROLLMENT_STATUSES.includes(item.enrollmentStatus)
}

/** The draft of an untouched row: the server's record, or nothing chosen. */
export function draftOf(item: Pick<AttendanceItem, 'record'>): AttendanceDraft {
  return { status: item.record?.status, minutesLate: item.record?.minutesLate ?? null, note: item.record?.note ?? '' }
}

/** The row as shown: the touched draft, else the server's record. */
export function currentDraft(item: AttendanceItem, drafts: AttendanceDrafts): AttendanceDraft {
  return drafts.get(item.student.id) ?? draftOf(item)
}

/** The values the server would store for a draft: minutes with `late` only, the note trimmed (blank = none). */
export function normaliseDraft(draft: AttendanceDraft): { status: AttendanceStatus | undefined; minutesLate: number | null; note: string | null } {
  const note = draft.note.trim()
  return { status: draft.status, minutesLate: draft.status === 'late' ? draft.minutesLate : null, note: note === '' ? null : note }
}

/** True when the draft would change the student's record (a row without a record changes once a status is chosen). */
export function isDraftChanged(item: AttendanceItem, draft: AttendanceDraft): boolean {
  const next = normaliseDraft(draft)
  if (!item.record) return next.status !== undefined
  return next.status !== item.record.status || next.minutesLate !== item.record.minutesLate || next.note !== item.record.note
}

/** The local mirror of the DTO rules for a draft about to be sent, or null when it is fine. */
export function draftProblem(draft: AttendanceDraft): DraftProblem | null {
  const next = normaliseDraft(draft)
  if (next.minutesLate !== null && (!Number.isInteger(next.minutesLate) || next.minutesLate < 1 || next.minutesLate > MINUTES_LATE_MAX)) return 'minutes_invalid'
  if (next.note !== null && next.note.length > ATTENDANCE_NOTE_MAX_LENGTH) return 'note_too_long'
  return null
}

/** The recordable rows whose draft differs from the server's record, in sheet order. */
export function changedItems(items: readonly AttendanceItem[], drafts: AttendanceDrafts): AttendanceItem[] {
  return items.filter((item) => isRecordableItem(item) && drafts.has(item.student.id) && isDraftChanged(item, drafts.get(item.student.id)!))
}

/** The whole new state of one student's record: minutesLate with `late` only, the note when not blank. */
export function recordInputOf(studentId: string, draft: AttendanceDraft): AttendanceRecordInput {
  const next = normaliseDraft(draft)
  if (!next.status) throw new Error(`No status chosen for ${studentId}`)
  const record: AttendanceRecordInput = { studentId, status: next.status }
  if (next.minutesLate !== null) record.minutesLate = next.minutesLate
  if (next.note !== null) record.note = next.note
  return record
}

/** The one PUT body (API-100) for the changed rows, or null when nothing changed. */
export function planAttendanceSave(items: readonly AttendanceItem[], drafts: AttendanceDrafts): RecordAttendanceInput | null {
  const records = changedItems(items, drafts).map((item) => recordInputOf(item.student.id, drafts.get(item.student.id)!))
  return records.length > 0 ? { records } : null
}

/** True when the batch is larger than the server accepts in one request. */
export function isBatchTooLarge(input: RecordAttendanceInput): boolean {
  return input.records.length > ATTENDANCE_BATCH_MAX
}

/** Recordable rows with no record and nothing chosen yet — the rows «mark all present» fills. */
export function unrecordedItems(items: readonly AttendanceItem[], drafts: AttendanceDrafts): AttendanceItem[] {
  return items.filter((item) => isRecordableItem(item) && !item.record && currentDraft(item, drafts).status === undefined)
}

/** «Mark all present»: every unrecorded row without a choice becomes present; rows already recorded or chosen keep theirs. */
export function markAllPresent(items: readonly AttendanceItem[], drafts: AttendanceDrafts): Map<string, AttendanceDraft> {
  const next = new Map(drafts)
  for (const item of unrecordedItems(items, drafts)) next.set(item.student.id, { ...currentDraft(item, drafts), status: 'present' })
  return next
}

/** The draft after choosing a status: leaving `late` drops the minutes (the server allows them with `late` only). */
export function withStatus(draft: AttendanceDraft, status: AttendanceStatus): AttendanceDraft {
  return { ...draft, status, minutesLate: status === 'late' ? draft.minutesLate : null }
}
