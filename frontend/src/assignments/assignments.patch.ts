// The smallest PATCH of an assignment (API-105, J-F38), on the pattern of
// lessons/lessons.form.ts: only fields whose value differs from the assignment
// as the server holds it — decimals compared at two decimals and instants by
// the minute, as planAssignmentUpdate() of the backend compares them; null
// clears instructions, lessonId, weight, dueAt and latePenaltyPercent; a
// localized text travels as a whole object and keeps a Turkish text the form
// does not edit; nothing changed → null (no request). The due date travels
// only when its date or its time was changed in the form: a wall clock left
// as it was keeps the stored instant (and its seconds) even when the form's
// zone moved with another lesson (dueZoneOf()). A refused field
// (`assignment_locked { fields }`) maps back onto the form through
// lockedFieldUpdates(). Pure; unit-tested in assignments.patch.test.ts.
import type { Assignment, UpdateAssignmentInput } from '../api/assignments'
import { localizedOf, sameLabel } from '../courses/courses.form'
import { assignmentFormValuesOf, dueAtOf } from './assignments.form'
import type { AssignmentFormValues } from './assignments.form'

/** The PATCH fields of API-105 (`ASSIGNMENT_PATCH_FIELDS` of assignments.changes.ts). */
export const ASSIGNMENT_PATCH_FIELDS = ['title', 'instructions', 'lessonId', 'maxScore', 'weight', 'dueAt', 'allowLate', 'latePenaltyPercent', 'maxAttempts'] as const
export type AssignmentPatchField = (typeof ASSIGNMENT_PATCH_FIELDS)[number]

/** The form fields (AssignmentFormValues) of each API field; the first one carries the field's message. */
export const FORM_FIELDS_OF_PATCH_FIELD: Readonly<Record<AssignmentPatchField, readonly (keyof AssignmentFormValues)[]>> = {
  title: ['titleAr', 'titleEn'],
  instructions: ['instructionsAr', 'instructionsEn'],
  lessonId: ['lessonId'],
  maxScore: ['maxScore'],
  weight: ['weight'],
  dueAt: ['dueDate', 'dueTime'],
  allowLate: ['allowLate'],
  latePenaltyPercent: ['latePenaltyPercent'],
  maxAttempts: ['maxAttempts'],
}

export function isAssignmentPatchField(field: string): field is AssignmentPatchField {
  return (ASSIGNMENT_PATCH_FIELDS as readonly string[]).includes(field)
}

/** A `numeric(p,2)` value as the server compares it. */
const decimal = (value: number | null | undefined) => (typeof value === 'number' ? value.toFixed(2) : null)

/** The native inputs carry minutes only: an instant the form did not move comes back truncated to its minute, which is no change. */
function sameMinute(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000)
}

/** The smallest PATCH body (API-105), or null when nothing changed; `zone` is the zone the due date was typed in. */
export function planAssignmentPatch(assignment: Assignment, values: AssignmentFormValues, zone: string): UpdateAssignmentInput | null {
  const body: UpdateAssignmentInput = {}
  const title = localizedOf(values.titleAr, values.titleEn, assignment.title.tr)
  if (title && !sameLabel(title, assignment.title)) body.title = title
  const instructions = localizedOf(values.instructionsAr, values.instructionsEn, assignment.instructions?.tr)
  if (!sameLabel(instructions, assignment.instructions)) body.instructions = instructions
  const lessonId = values.lessonId || null
  if (lessonId !== (assignment.lesson?.id ?? null)) body.lessonId = lessonId
  if (typeof values.maxScore === 'number' && decimal(values.maxScore) !== decimal(assignment.maxScore)) body.maxScore = values.maxScore
  const weight = values.weight ?? null
  if (decimal(weight) !== decimal(assignment.weight)) body.weight = weight
  const initial = assignmentFormValuesOf(assignment)
  if ((values.dueDate ?? '') !== initial.dueDate || (values.dueTime ?? '') !== initial.dueTime) {
    const dueAt = dueAtOf(values, zone)
    if (dueAt !== undefined && !sameMinute(dueAt, assignment.dueAt)) body.dueAt = dueAt
  }
  if (typeof values.allowLate === 'boolean' && values.allowLate !== assignment.allowLate) body.allowLate = values.allowLate
  const penalty = values.latePenaltyPercent ?? null
  if (decimal(penalty) !== decimal(assignment.latePenaltyPercent)) body.latePenaltyPercent = penalty
  if (typeof values.maxAttempts === 'number' && values.maxAttempts !== assignment.maxAttempts) body.maxAttempts = values.maxAttempts
  return Object.keys(body).length > 0 ? body : null
}

/** One entry of antd's `form.setFields()`. */
export interface FormFieldUpdate {
  name: string[]
  value: unknown
  errors: string[]
}

/**
 * The form after `assignment_locked { fields }`: each refused field goes back
 * to the value the server holds and its first input carries `message`; the
 * other changes of the session stay as typed. API names the form does not
 * render are skipped.
 */
export function lockedFieldUpdates(assignment: Assignment, fields: readonly string[], message: string): FormFieldUpdate[] {
  const initial = assignmentFormValuesOf(assignment)
  return fields.filter(isAssignmentPatchField).flatMap((field) =>
    FORM_FIELDS_OF_PATCH_FIELD[field].map((name, index) => ({ name: [name], value: initial[name], errors: index === 0 ? [message] : [] })),
  )
}
