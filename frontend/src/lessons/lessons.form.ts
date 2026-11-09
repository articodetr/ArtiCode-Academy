// Lesson form ↔ API bodies (J-F09), on the pattern of classes/classes.form.ts:
// the create body carries only what was filled in (the server defaults the
// teacher to the class's lead teacher and the delivery mode to in_person); the
// PATCH body carries only fields whose value differs from the loaded lesson
// (null clears the optional links and the description); a localized text
// travels as a whole object and keeps a Turkish text the form does not edit;
// nothing changed → null (no request). The day and the two times are a wall
// clock in one zone (D-R41 — J-F28): the lesson's own `timeZone` when editing,
// the academy's for a new lesson (it has no zone yet). Local rules mirror
// backend/src/lessons/lessons.dto.ts — the server decides. The edit form holds
// unsaved work while lessonFormHasChanges() says so (KI-058 — J-F40).
import { MEETING_URL_PATTERN } from '../api/lessons'
import type { CreateLessonInput, DeliveryMode, Lesson, UpdateLessonInput } from '../api/lessons'
import { englishWithoutArabic, localizedOf, sameLabel } from '../courses/courses.form'
import { rangeOf, zonedPartsOf } from './lessons.format'

/**
 * Value of the teacher Select meaning "no teacher" (`teacherUserId: null`), as
 * opposed to leaving it empty on creation (= the class's lead teacher — D-R33 (3)).
 */
export const NO_TEACHER = '__none__'

export interface LessonFormValues {
  /** Creation only: the class is fixed afterwards. */
  classId?: string
  titleAr: string
  titleEn?: string
  descriptionAr?: string
  descriptionEn?: string
  deliveryMode: DeliveryMode
  /** `YYYY-MM-DD` and `HH:MM` from the native inputs, on the wall clock of the form's zone (the lesson's, or the academy's for a new one). */
  date: string
  startTime: string
  endTime: string
  roomId?: string
  /** A teacher of the class, NO_TEACHER, or empty (creation: the default lead teacher). */
  teacherUserId?: string
  syllabusItemId?: string
  meetingUrl?: string
}

const text = (value: string | undefined) => (value ?? '').trim()

/** The native inputs carry minutes only: an instant the form did not touch comes back truncated to its minute, which is no change. */
function sameMinute(a: string, b: string): boolean {
  const minute = (value: string) => Math.floor(new Date(value).getTime() / 60_000)
  return minute(a) === minute(b)
}

/** True for a blank value or an `https://` link without spaces (`MEETING_URL_PATTERN`). */
export function isMeetingUrlValid(value: string | undefined): boolean {
  const trimmed = text(value)
  return trimmed === '' || MEETING_URL_PATTERN.test(trimmed)
}

/** Initial form values of a loaded lesson — its day and times in its own zone (`timeZone` — D-R41); null → empty; no teacher → NO_TEACHER. */
export function lessonFormValuesOf(lesson: Lesson): LessonFormValues {
  const start = zonedPartsOf(lesson.startsAt, lesson.timeZone)
  const end = zonedPartsOf(lesson.endsAt, lesson.timeZone)
  return {
    classId: lesson.class.id,
    titleAr: lesson.title.ar,
    titleEn: lesson.title.en ?? '',
    descriptionAr: lesson.description?.ar ?? '',
    descriptionEn: lesson.description?.en ?? '',
    deliveryMode: lesson.deliveryMode,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    roomId: lesson.room?.id,
    teacherUserId: lesson.teacher?.userId ?? NO_TEACHER,
    syllabusItemId: lesson.syllabusItem?.id,
    meetingUrl: lesson.meetingUrl ?? '',
  }
}

/** The create body; the day and times are read in `timeZone` (the academy's — a new lesson has no zone of its own yet). */
export function buildCreateLessonInput(values: LessonFormValues, timeZone: string): CreateLessonInput {
  const range = rangeOf(values.date, values.startTime, values.endTime, timeZone)
  const input: CreateLessonInput = {
    title: localizedOf(values.titleAr, values.titleEn) ?? { ar: text(values.titleAr) },
    deliveryMode: values.deliveryMode,
    startsAt: range?.startsAt ?? '',
    endsAt: range?.endsAt ?? '',
  }
  const description = localizedOf(values.descriptionAr, values.descriptionEn)
  if (description) input.description = description
  if (values.roomId) input.roomId = values.roomId
  if (values.teacherUserId === NO_TEACHER) input.teacherUserId = null
  else if (values.teacherUserId) input.teacherUserId = values.teacherUserId
  if (values.syllabusItemId) input.syllabusItemId = values.syllabusItemId
  const meetingUrl = text(values.meetingUrl)
  if (meetingUrl) input.meetingUrl = meetingUrl
  return input
}

/**
 * The smallest PATCH body (API-096), or null when nothing changed. The typed
 * day and times are read in the lesson's own zone; an instant is sent only
 * when the fields it depends on were edited AND it moved — the start on the
 * day or the start time, the end on any of the three (the next-day rule ties
 * it to the start) — so a lesson whose time occurs twice on a night the clock
 * goes back keeps its instant when only its title changes.
 */
export function planLessonPatch(lesson: Lesson, values: LessonFormValues): UpdateLessonInput | null {
  const body: UpdateLessonInput = {}
  const title = localizedOf(values.titleAr, values.titleEn, lesson.title.tr)
  if (title && !sameLabel(title, lesson.title)) body.title = title
  const description = localizedOf(values.descriptionAr, values.descriptionEn, lesson.description?.tr)
  if (!sameLabel(description, lesson.description)) body.description = description
  if (values.deliveryMode !== lesson.deliveryMode) body.deliveryMode = values.deliveryMode
  const loaded = lessonFormValuesOf(lesson)
  const startEdited = values.date !== loaded.date || values.startTime !== loaded.startTime
  const endEdited = startEdited || values.endTime !== loaded.endTime
  const range = endEdited ? rangeOf(values.date, values.startTime, values.endTime, lesson.timeZone) : undefined
  if (range) {
    if (startEdited && !sameMinute(range.startsAt, lesson.startsAt)) body.startsAt = range.startsAt
    if (!sameMinute(range.endsAt, lesson.endsAt)) body.endsAt = range.endsAt
  }
  const roomId = values.roomId || null
  if (roomId !== (lesson.room?.id ?? null)) body.roomId = roomId
  if (values.teacherUserId !== undefined) {
    const teacherUserId = values.teacherUserId === NO_TEACHER || values.teacherUserId === '' ? null : values.teacherUserId
    if (teacherUserId !== (lesson.teacher?.userId ?? null)) body.teacherUserId = teacherUserId
  }
  const syllabusItemId = values.syllabusItemId || null
  if (syllabusItemId !== (lesson.syllabusItem?.id ?? null)) body.syllabusItemId = syllabusItemId
  const meetingUrl = text(values.meetingUrl) || null
  if (meetingUrl !== lesson.meetingUrl) body.meetingUrl = meetingUrl
  return Object.keys(body).length > 0 ? body : null
}

/** An emptied field: `undefined` is a field the form does not show. */
const isBlank = (value: string | undefined) => typeof value === 'string' && value.trim() === ''

/**
 * Whether the edit form of the lesson drawer holds unsaved work (KI-058 —
 * J-F40, the rule of J-F23's courseFormHasChanges()), always compared with the
 * lesson as loaded, so a field changed back holds nothing and spaces around a
 * text are no change (the save trims them): the smallest PATCH
 * is non-empty (planLessonPatch()), or the form holds what the save would
 * refuse instead of sending — an emptied Arabic title (an English title alone
 * included), an English description without its Arabic text (planLessonPatch()
 * sends nothing for either), an emptied day or time (rangeOf() then reads no
 * range, so no instant is sent).
 */
export function lessonFormHasChanges(lesson: Lesson, values: LessonFormValues): boolean {
  return (
    isBlank(values.titleAr) ||
    englishWithoutArabic(values.descriptionAr, values.descriptionEn) ||
    isBlank(values.date) ||
    isBlank(values.startTime) ||
    isBlank(values.endTime) ||
    planLessonPatch(lesson, values) !== null
  )
}
