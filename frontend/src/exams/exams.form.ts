// Exam form ↔ API-115 body (J-F45), on the pattern of assignments/assignments.form.ts:
// the create body carries what was filled in (no lesson, no date, no duration,
// no pass score and no weight unless given); a localized text travels as a
// whole `{ ar, en? }` object. The exam's date is typed as a calendar date and a
// wall clock of the zone examZoneOf() names (exams.zone.ts) and sent as an
// instant. The smallest PATCH is planned in exams.patch.ts. Pure.
//
// MOD-09 phase 2: the form also chooses the delivery. A `manual` exam (the
// default) builds exactly the body it always built — no `delivery`, no online
// setting (the server answers `online_settings_not_allowed` to one). An
// `online` exam adds `delivery` and its four settings as the form shows them:
// the closing of its window (typed like the exam date, in the same zone — the
// exam date is then the opening), the attempts allowed, when a learner sees
// their result and whether the correct answers are revealed.
import type { CreateExamInput, Exam, ExamDelivery, ExamResultsRelease, ExamType } from '../api/exams'
import { instantIn, wallClockIn } from '../assignments/assignments.zone'
import { localizedOf } from '../courses/courses.form'

export interface ExamFormValues {
  /** Creation only: the class is fixed afterwards. */
  classId?: string
  /** A lesson of the class; empty = none. */
  lessonId?: string
  titleAr: string
  titleEn?: string
  descriptionAr?: string
  descriptionEn?: string
  /** Required: the server has no default. */
  type?: ExamType
  /** `YYYY-MM-DD` and `HH:MM` from the native inputs, in the zone examZoneOf() names; both blank = not dated yet. For an online exam: when its window opens. */
  scheduledDate?: string
  scheduledTime?: string
  /** InputNumber values: null once cleared. For an online exam: the time limit of one attempt. */
  durationMinutes?: number | null
  maxScore: number | null
  passScore?: number | null
  weight?: number | null
  /** `manual` (the teacher records the results) or `online` (taken on the platform); it changes in a draft only. */
  delivery?: ExamDelivery
  // The four settings of an online exam. Their inputs are on screen only while the form says `online`, so a form
  // showing a manual exam reports them as undefined.
  /** When the window closes, typed like the exam date and in the same zone; both blank = not set yet. */
  closesDate?: string
  closesTime?: string
  /** The attempts each student gets (1..20); null once cleared — the form refuses that. */
  attemptsAllowed?: number | null
  /** When a learner sees their own result. */
  resultsRelease?: ExamResultsRelease
  /** Whether the correct answers show with the result once the window has closed. */
  revealAnswers?: boolean
}

/** What a new exam's form starts from: a manual exam, with the server's defaults of the online settings ready for a switch to online (`MANUAL_SETTINGS` of exams.online.ts). */
export const NEW_EXAM_FORM_VALUES = { delivery: 'manual', attemptsAllowed: 1, resultsRelease: 'on_publish', revealAnswers: false } as const satisfies Partial<ExamFormValues>

const text = (value: string | undefined) => (value ?? '').trim()

const NO_WALL_CLOCK = { date: '', time: '' }

/** Initial form values of a loaded exam; its date (and the closing of an online exam's window) as the wall clock of its own `timeZone`. */
export function examFormValuesOf(exam: Exam): ExamFormValues {
  const at = exam.scheduledAt ? wallClockIn(exam.scheduledAt, exam.timeZone) : NO_WALL_CLOCK
  const closes = exam.closesAt ? wallClockIn(exam.closesAt, exam.timeZone) : NO_WALL_CLOCK
  return {
    classId: exam.class.id,
    lessonId: exam.lesson?.id,
    titleAr: exam.title.ar,
    titleEn: exam.title.en ?? '',
    descriptionAr: exam.description?.ar ?? '',
    descriptionEn: exam.description?.en ?? '',
    type: exam.type,
    scheduledDate: at.date,
    scheduledTime: at.time,
    durationMinutes: exam.durationMinutes,
    maxScore: exam.maxScore,
    passScore: exam.passScore,
    weight: exam.weight,
    // A manual exam holds the defaults (no closing, one attempt, results on publish, no revealed answers).
    delivery: exam.delivery,
    closesDate: closes.date,
    closesTime: closes.time,
    attemptsAllowed: exam.attemptsAllowed,
    resultsRelease: exam.resultsRelease,
    revealAnswers: exam.revealAnswers,
  }
}

/** The exam's instant in `zone`: null when both halves are blank, undefined when one is missing (the form refuses it). */
export function scheduledAtOf(values: Pick<ExamFormValues, 'scheduledDate' | 'scheduledTime'>, zone: string): string | null | undefined {
  if (!values.scheduledDate && !values.scheduledTime) return null
  return instantIn(values.scheduledDate, values.scheduledTime, zone)
}

/** When an online exam's window closes, in `zone`: null when both halves are blank, undefined when one is missing (the form refuses it). */
export function closesAtOf(values: Pick<ExamFormValues, 'closesDate' | 'closesTime'>, zone: string): string | null | undefined {
  if (!values.closesDate && !values.closesTime) return null
  return instantIn(values.closesDate, values.closesTime, zone)
}

const isNumber = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)

/** The body of API-115; `zone` is the zone the exam's date was typed in. */
export function buildCreateExamInput(values: ExamFormValues, zone: string): CreateExamInput {
  const input: CreateExamInput = {
    title: localizedOf(values.titleAr, values.titleEn) ?? { ar: text(values.titleAr) },
    // The form requires a type; `quiz` only satisfies the type checker.
    type: values.type ?? 'quiz',
    maxScore: values.maxScore ?? 0,
  }
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (description) input.description = description
  if (values.lessonId) input.lessonId = values.lessonId
  const scheduledAt = scheduledAtOf(values, zone)
  if (scheduledAt) input.scheduledAt = scheduledAt
  if (isNumber(values.durationMinutes)) input.durationMinutes = values.durationMinutes
  if (isNumber(values.passScore)) input.passScore = values.passScore
  if (isNumber(values.weight)) input.weight = values.weight
  // A manual exam names neither its delivery nor an online setting: its body is what it was before the online phase.
  if (values.delivery === 'online') {
    input.delivery = 'online'
    const closesAt = closesAtOf(values, zone)
    if (closesAt) input.closesAt = closesAt
    // As the form shows them (JSON number, JSON boolean), so the exam is created with what its author saw.
    if (isNumber(values.attemptsAllowed)) input.attemptsAllowed = values.attemptsAllowed
    if (values.resultsRelease) input.resultsRelease = values.resultsRelease
    if (typeof values.revealAnswers === 'boolean') input.revealAnswers = values.revealAnswers
  }
  return input
}
