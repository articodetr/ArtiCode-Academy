// Exam form ↔ API-115 body (J-F45), on the pattern of assignments/assignments.form.ts:
// the create body carries what was filled in (no lesson, no date, no duration,
// no pass score and no weight unless given); a localized text travels as a
// whole `{ ar, en? }` object. The exam's date is typed as a calendar date and a
// wall clock of the zone examZoneOf() names (exams.zone.ts) and sent as an
// instant. The smallest PATCH is planned in exams.patch.ts. Pure.
import type { CreateExamInput, Exam, ExamType } from '../api/exams'
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
  /** `YYYY-MM-DD` and `HH:MM` from the native inputs, in the zone examZoneOf() names; both blank = not dated yet. */
  scheduledDate?: string
  scheduledTime?: string
  /** InputNumber values: null once cleared. */
  durationMinutes?: number | null
  maxScore: number | null
  passScore?: number | null
  weight?: number | null
}

const text = (value: string | undefined) => (value ?? '').trim()

/** Initial form values of a loaded exam; its date as the wall clock of its own `timeZone`. */
export function examFormValuesOf(exam: Exam): ExamFormValues {
  const at = exam.scheduledAt ? wallClockIn(exam.scheduledAt, exam.timeZone) : { date: '', time: '' }
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
  }
}

/** The exam's instant in `zone`: null when both halves are blank, undefined when one is missing (the form refuses it). */
export function scheduledAtOf(values: Pick<ExamFormValues, 'scheduledDate' | 'scheduledTime'>, zone: string): string | null | undefined {
  if (!values.scheduledDate && !values.scheduledTime) return null
  return instantIn(values.scheduledDate, values.scheduledTime, zone)
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
  return input
}
