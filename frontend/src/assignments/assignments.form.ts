// Assignment form ↔ API-104 body (J-F38), on the pattern of lessons/lessons.form.ts:
// the create body carries what was filled in and what differs from the
// server's defaults (no lesson, no weight, no due date, allowLate false,
// one attempt); a localized text travels as a whole `{ ar, en? }` object. The
// due date is typed as a calendar date and a wall clock of the zone that
// dueZoneOf() names (assignments.zone.ts) and sent as an instant. The smallest
// PATCH is planned in assignments.patch.ts. Pure.
import { DEFAULT_MAX_ATTEMPTS } from '../api/assignments'
import type { Assignment, CreateAssignmentInput } from '../api/assignments'
import { localizedOf } from '../courses/courses.form'
import { instantIn, wallClockIn } from './assignments.zone'

export interface AssignmentFormValues {
  /** Creation only: the class is fixed afterwards. */
  classId?: string
  /** A lesson of the class; empty = none. */
  lessonId?: string
  titleAr: string
  titleEn?: string
  instructionsAr?: string
  instructionsEn?: string
  /** InputNumber values: null once cleared. */
  maxScore: number | null
  weight?: number | null
  /** `YYYY-MM-DD` and `HH:MM` from the native inputs, in the zone dueZoneOf() names; both blank = no due date. */
  dueDate?: string
  dueTime?: string
  allowLate: boolean
  latePenaltyPercent?: number | null
  maxAttempts: number | null
}

/** The values a new assignment starts from (the server's defaults). */
export const NEW_ASSIGNMENT_VALUES: Partial<AssignmentFormValues> = { allowLate: false, maxAttempts: DEFAULT_MAX_ATTEMPTS }

const text = (value: string | undefined) => (value ?? '').trim()

/** Initial form values of a loaded assignment; the due date as the wall clock of its own `timeZone`. */
export function assignmentFormValuesOf(assignment: Assignment): AssignmentFormValues {
  const due = assignment.dueAt ? wallClockIn(assignment.dueAt, assignment.timeZone) : { date: '', time: '' }
  return {
    classId: assignment.class.id,
    lessonId: assignment.lesson?.id,
    titleAr: assignment.title.ar,
    titleEn: assignment.title.en ?? '',
    instructionsAr: assignment.instructions?.ar ?? '',
    instructionsEn: assignment.instructions?.en ?? '',
    maxScore: assignment.maxScore,
    weight: assignment.weight,
    dueDate: due.date,
    dueTime: due.time,
    allowLate: assignment.allowLate,
    latePenaltyPercent: assignment.latePenaltyPercent,
    maxAttempts: assignment.maxAttempts,
  }
}

/** The due instant of the form in `zone`: null when both halves are blank, undefined when one is missing (the form refuses it). */
export function dueAtOf(values: Pick<AssignmentFormValues, 'dueDate' | 'dueTime'>, zone: string): string | null | undefined {
  if (!values.dueDate && !values.dueTime) return null
  return instantIn(values.dueDate, values.dueTime, zone)
}

const isNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** The body of API-104; `zone` is the zone the due date was typed in. */
export function buildCreateAssignmentInput(values: AssignmentFormValues, zone: string): CreateAssignmentInput {
  const input: CreateAssignmentInput = {
    title: localizedOf(values.titleAr, values.titleEn) ?? { ar: text(values.titleAr) },
    maxScore: values.maxScore ?? 0,
  }
  const instructions = localizedOf(values.instructionsAr, values.instructionsEn)
  if (instructions) input.instructions = instructions
  if (values.lessonId) input.lessonId = values.lessonId
  if (isNumber(values.weight)) input.weight = values.weight
  const dueAt = dueAtOf(values, zone)
  if (dueAt) input.dueAt = dueAt
  if (values.allowLate) input.allowLate = true
  if (isNumber(values.latePenaltyPercent)) input.latePenaltyPercent = values.latePenaltyPercent
  if (isNumber(values.maxAttempts) && values.maxAttempts !== DEFAULT_MAX_ATTEMPTS) input.maxAttempts = values.maxAttempts
  return input
}
