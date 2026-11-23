// The smallest PATCH of an exam (API-116, J-F45), on the pattern of
// assignments/assignments.patch.ts: only fields whose value differs from the
// exam as the server holds it — decimals compared at two decimals and instants
// by the minute, as planExamUpdate() of the backend compares them; null clears
// description, lessonId, scheduledAt, durationMinutes, passScore and weight; a
// localized text travels as a whole object and keeps a Turkish text the form
// does not edit; nothing changed → null (no request). The exam's date travels
// only when its date or its time was changed in the form: a wall clock left as
// it was keeps the stored instant (and its seconds) even when the form's zone
// moved with another lesson (examZoneOf()). A refused field (`exam_locked {
// fields }`) maps back onto the form through lockedFieldUpdates(). Whether the
// form holds unsaved work at all (the drawer's guard) is examFormHasChanges().
// Pure; unit-tested in exams.patch.test.ts.
//
// MOD-09 phase 2 — the online side, in the same PATCH. `delivery` travels when
// the form changed it (a draft only). An exam that is manual, or that the form
// turns manual, never names an online setting — the server answers `400
// online_settings_not_allowed` to one and resets them itself when an online
// draft turns manual (unlinking its questions: turnsManual() makes the form ask
// first). For an online exam the closing of the window travels like the exam
// date (only when its date or time was changed; null clears it), the attempts,
// the release policy and the revealed answers when they differ. What the
// server would lock for the online side is lockedOnlineFields() of
// exams.status.ts; reopensRevealedWindow() is the one warning the server does
// not give (KI-130).
import type { Exam, UpdateExamInput } from '../api/exams'
import { englishWithoutArabic, localizedOf, sameLabel } from '../courses/courses.form'
import { closesAtOf, examFormValuesOf, scheduledAtOf } from './exams.form'
import type { ExamFormValues } from './exams.form'
import { missingSchedulePart } from './exams.validation'

/** The online fields of API-116 (`ONLINE_FIELDS` of exams.online.ts). */
export const ONLINE_PATCH_FIELDS = ['delivery', 'closesAt', 'attemptsAllowed', 'resultsRelease', 'revealAnswers'] as const

/** The PATCH fields of API-116 (`EXAM_PATCH_FIELDS` of exams.changes.ts, then the online ones). */
export const EXAM_PATCH_FIELDS = ['title', 'description', 'type', 'lessonId', 'scheduledAt', 'durationMinutes', 'maxScore', 'passScore', 'weight', ...ONLINE_PATCH_FIELDS] as const
export type ExamPatchField = (typeof EXAM_PATCH_FIELDS)[number]

/** The form fields (ExamFormValues) of each API field; the first one carries the field's message. */
export const FORM_FIELDS_OF_PATCH_FIELD: Readonly<Record<ExamPatchField, readonly (keyof ExamFormValues)[]>> = {
  title: ['titleAr', 'titleEn'],
  description: ['descriptionAr', 'descriptionEn'],
  type: ['type'],
  lessonId: ['lessonId'],
  scheduledAt: ['scheduledDate', 'scheduledTime'],
  durationMinutes: ['durationMinutes'],
  maxScore: ['maxScore'],
  passScore: ['passScore'],
  weight: ['weight'],
  delivery: ['delivery'],
  closesAt: ['closesDate', 'closesTime'],
  attemptsAllowed: ['attemptsAllowed'],
  resultsRelease: ['resultsRelease'],
  revealAnswers: ['revealAnswers'],
}

export function isExamPatchField(field: string): field is ExamPatchField {
  return (EXAM_PATCH_FIELDS as readonly string[]).includes(field)
}

/** The i18n key of a PATCH field's name: the first phase's under `exams.patchFields`, the online ones under `examOnline.patchFields`. */
export function patchFieldLabelKey(field: ExamPatchField): string {
  return (ONLINE_PATCH_FIELDS as readonly string[]).includes(field) ? `examOnline.patchFields.${field}` : `exams.patchFields.${field}`
}

/** A `numeric(p,2)` value as the server compares it. */
const decimal = (value: number | null | undefined) => (typeof value === 'number' ? value.toFixed(2) : null)

/** The native inputs carry minutes only: an instant the form did not move comes back truncated to its minute, which is no change. */
function sameMinute(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return Math.floor(Date.parse(a) / 60_000) === Math.floor(Date.parse(b) / 60_000)
}

/** The delivery the form asks for; a form that does not report one leaves the exam's. */
const deliveryOf = (exam: Pick<Exam, 'delivery'>, values: Pick<ExamFormValues, 'delivery'>) => values.delivery ?? exam.delivery

/** The smallest PATCH body (API-116), or null when nothing changed; `zone` is the zone the exam's date was typed in. */
export function planExamPatch(exam: Exam, values: ExamFormValues, zone: string): UpdateExamInput | null {
  const body: UpdateExamInput = {}
  const title = localizedOf(values.titleAr, values.titleEn, exam.title.tr)
  if (title && !sameLabel(title, exam.title)) body.title = title
  const description = localizedOf(values.descriptionAr, values.descriptionEn, exam.description?.tr)
  if (!sameLabel(description, exam.description)) body.description = description
  if (values.type && values.type !== exam.type) body.type = values.type
  const lessonId = values.lessonId || null
  if (lessonId !== (exam.lesson?.id ?? null)) body.lessonId = lessonId
  const initial = examFormValuesOf(exam)
  if ((values.scheduledDate ?? '') !== initial.scheduledDate || (values.scheduledTime ?? '') !== initial.scheduledTime) {
    const scheduledAt = scheduledAtOf(values, zone)
    if (scheduledAt !== undefined && !sameMinute(scheduledAt, exam.scheduledAt)) body.scheduledAt = scheduledAt
  }
  const duration = values.durationMinutes ?? null
  if (duration !== exam.durationMinutes) body.durationMinutes = duration
  if (typeof values.maxScore === 'number' && decimal(values.maxScore) !== decimal(exam.maxScore)) body.maxScore = values.maxScore
  const passScore = values.passScore ?? null
  if (decimal(passScore) !== decimal(exam.passScore)) body.passScore = passScore
  const weight = values.weight ?? null
  if (decimal(weight) !== decimal(exam.weight)) body.weight = weight

  // The online side. A manual exam — as it is, or as the form makes it — names no online setting.
  const delivery = deliveryOf(exam, values)
  if (delivery !== exam.delivery) body.delivery = delivery
  if (delivery === 'online') {
    // Undefined halves: the closing's inputs are not on screen (yet) — nothing to compare. Otherwise it travels like
    // the exam date: only when its date or its time was changed.
    const closesShown = values.closesDate !== undefined || values.closesTime !== undefined
    if (closesShown && ((values.closesDate ?? '') !== initial.closesDate || (values.closesTime ?? '') !== initial.closesTime)) {
      const closesAt = closesAtOf(values, zone)
      if (closesAt !== undefined && !sameMinute(closesAt, exam.closesAt)) body.closesAt = closesAt
    }
    if (typeof values.attemptsAllowed === 'number' && values.attemptsAllowed !== exam.attemptsAllowed) body.attemptsAllowed = values.attemptsAllowed
    if (values.resultsRelease && values.resultsRelease !== exam.resultsRelease) body.resultsRelease = values.resultsRelease
    if (typeof values.revealAnswers === 'boolean' && values.revealAnswers !== exam.revealAnswers) body.revealAnswers = values.revealAnswers
  }
  return Object.keys(body).length > 0 ? body : null
}

const isBlank = (value: string | undefined) => typeof value === 'string' && value.trim() === ''

/**
 * Whether the edit form of the exam drawer holds unsaved work (the rule of
 * lessonFormHasChanges() — KI-058), always compared with the exam as loaded, so
 * a field changed back holds nothing and spaces around a text are no change (the
 * save trims them): the smallest PATCH is non-empty, or the form holds what the
 * save would refuse instead of sending — an emptied Arabic title, an English
 * text without its Arabic one, an emptied maximum score, or one half of the
 * exam's date without the other (planExamPatch() sends nothing for any of them);
 * for an online exam also one half of the closing without the other and an
 * emptied number of attempts.
 */
export function examFormHasChanges(exam: Exam, values: ExamFormValues, zone: string): boolean {
  return (
    isBlank(values.titleAr) ||
    englishWithoutArabic(values.titleAr, values.titleEn) ||
    englishWithoutArabic(values.descriptionAr, values.descriptionEn) ||
    values.maxScore === null ||
    missingSchedulePart(values.scheduledDate, values.scheduledTime) !== null ||
    (deliveryOf(exam, values) === 'online' && (missingSchedulePart(values.closesDate, values.closesTime) !== null || values.attemptsAllowed === null)) ||
    planExamPatch(exam, values, zone) !== null
  )
}

/** The PATCH turns an online exam manual: the server resets its online settings and unlinks its questions, so the form asks first. */
export function turnsManual(exam: Pick<Exam, 'delivery'>, body: UpdateExamInput): boolean {
  return exam.delivery === 'online' && body.delivery === 'manual'
}

/**
 * KI-130 — the warning the server does not give. The PATCH moves the closing
 * later on an online exam the learners have had (not a draft: nobody ever
 * started one) whose window has already closed and that reveals the correct
 * answers: whoever finished may have seen them, and a reopened window lets a
 * student with an attempt left use them. The stored `revealAnswers` counts —
 * switching it off in the same save takes nothing back. `now` is this device's
 * clock: the exam carries no server clock, and a warning needs none.
 */
export function reopensRevealedWindow(exam: Pick<Exam, 'delivery' | 'status' | 'closesAt' | 'revealAnswers'>, body: UpdateExamInput, now: number): boolean {
  if (exam.delivery !== 'online' || exam.status === 'draft' || !exam.revealAnswers || exam.closesAt === null) return false
  const closed = Date.parse(exam.closesAt)
  return closed <= now && typeof body.closesAt === 'string' && Date.parse(body.closesAt) > closed
}

/** One entry of antd's `form.setFields()`. */
export interface FormFieldUpdate {
  name: string[]
  value: unknown
  errors: string[]
}

/**
 * The form after `exam_locked { fields }`: each refused field goes back to the
 * value the server holds and its first input carries the message — one text
 * for all, or the text of each field (an online exam locks its fields for
 * different reasons); the other changes of the session stay as typed. API names
 * the form does not render are skipped.
 */
export function lockedFieldUpdates(exam: Exam, fields: readonly string[], message: string | ((field: ExamPatchField) => string)): FormFieldUpdate[] {
  const initial = examFormValuesOf(exam)
  return fields.filter(isExamPatchField).flatMap((field) => {
    const text = typeof message === 'string' ? message : message(field)
    return FORM_FIELDS_OF_PATCH_FIELD[field].map((name, index) => ({ name: [name], value: initial[name], errors: index === 0 ? [text] : [] }))
  })
}
