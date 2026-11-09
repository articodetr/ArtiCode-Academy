import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS } from '../test/courses'
import { FAR_TIME_ZONE, LESSON_TIME_ZONE, makeLesson } from '../test/lessons'
import { withTimeZone } from '../test/time-zone'
import { ROOM_ID } from '../test/timetable'
import { NO_TEACHER, buildCreateLessonInput, isMeetingUrlValid, lessonFormValuesOf, planLessonPatch } from './lessons.form'
import type { LessonFormValues } from './lessons.form'

const BERLIN = 'Europe/Berlin'
const NEW_YORK = 'America/New_York'

// 2026-11-10 10:00–11:30 UTC in the academy's zone (Asia/Riyadh, UTC+3): 13:00–14:30 on its wall clock.
const lesson = makeLesson({ description: { ar: 'مقدمة', tr: 'Giriş' }, meetingUrl: 'https://meet.example.com/a' })

function values(overrides: Partial<LessonFormValues> = {}): LessonFormValues {
  return { ...lessonFormValuesOf(lesson), ...overrides }
}

describe('lessons.form', () => {
  it('derives the form values from a lesson: its day and times in its own zone, the current links, NO_TEACHER for none', () => {
    expect(lesson.timeZone).toBe(LESSON_TIME_ZONE)
    expect(lessonFormValuesOf(lesson)).toEqual({
      classId: lesson.class.id,
      titleAr: 'المتغيرات وأنواع البيانات',
      titleEn: 'Variables and data types',
      descriptionAr: 'مقدمة',
      descriptionEn: '',
      deliveryMode: 'in_person',
      date: '2026-11-10',
      startTime: '13:00',
      endTime: '14:30',
      roomId: ROOM_ID,
      teacherUserId: lesson.teacher!.userId,
      syllabusItemId: SYLLABUS_ITEM_IDS[0],
      meetingUrl: 'https://meet.example.com/a',
    })
    // The lesson's zone, not the browser's: the same instants in UTC+14 are past midnight there (D-R41 — J-F28).
    const far = makeLesson({ timeZone: FAR_TIME_ZONE })
    expect(lessonFormValuesOf(far)).toMatchObject({ date: '2026-11-11', startTime: '00:00', endTime: '01:30' })
    withTimeZone('America/Los_Angeles', () => expect(lessonFormValuesOf(far)).toMatchObject({ date: '2026-11-11', startTime: '00:00', endTime: '01:30' }))
    expect(lessonFormValuesOf(makeLesson({ teacher: null, room: null, syllabusItem: null })).teacherUserId).toBe(NO_TEACHER)
    expect(lessonFormValuesOf(makeLesson({ teacher: null, room: null, syllabusItem: null })).roomId).toBeUndefined()
  })

  it('builds the create body in the given zone (the academy’s) with what was filled in: the default teacher is left to the server, NO_TEACHER travels as null', () => {
    expect(
      buildCreateLessonInput({ titleAr: ' الدوال ', deliveryMode: 'live_online', date: '2026-11-12', startTime: '09:00', endTime: '10:30', meetingUrl: ' https://meet.example.com/b ' }, LESSON_TIME_ZONE),
    ).toEqual({
      title: { ar: 'الدوال' },
      deliveryMode: 'live_online',
      startsAt: '2026-11-12T06:00:00.000Z',
      endsAt: '2026-11-12T07:30:00.000Z',
      meetingUrl: 'https://meet.example.com/b',
    })
    expect(
      buildCreateLessonInput(
        {
          titleAr: 'الدوال',
          titleEn: 'Functions',
          descriptionAr: 'وصف',
          deliveryMode: 'in_person',
          date: '2026-11-12',
          startTime: '09:00',
          endTime: '10:30',
          roomId: ROOM_ID,
          teacherUserId: NO_TEACHER,
          syllabusItemId: SYLLABUS_ITEM_IDS[1],
          meetingUrl: '',
        },
        FAR_TIME_ZONE,
      ),
    ).toEqual({
      title: { ar: 'الدوال', en: 'Functions' },
      description: { ar: 'وصف' },
      deliveryMode: 'in_person',
      // 09:00 on the 12th in UTC+14 is the 11th at 19:00 UTC.
      startsAt: '2026-11-11T19:00:00.000Z',
      endsAt: '2026-11-11T20:30:00.000Z',
      roomId: ROOM_ID,
      teacherUserId: null,
      syllabusItemId: SYLLABUS_ITEM_IDS[1],
    })
    expect(buildCreateLessonInput({ titleAr: 'x', deliveryMode: 'hybrid', date: '2026-11-12', startTime: '09:00', endTime: '10:30', teacherUserId: 'teacher-2' }, LESSON_TIME_ZONE).teacherUserId).toBe('teacher-2')
  })

  it('plans the smallest PATCH: changed fields only, null clears, the Turkish texts survive, nothing changed → null', () => {
    expect(planLessonPatch(lesson, values())).toBeNull()
    expect(planLessonPatch(lesson, values({ titleEn: 'Variables and data types ' }))).toBeNull()
    expect(planLessonPatch(lesson, values({ titleAr: 'الأنواع', descriptionAr: '', roomId: undefined, teacherUserId: NO_TEACHER, syllabusItemId: undefined, meetingUrl: ' ' }))).toEqual({
      title: { ar: 'الأنواع', en: 'Variables and data types' },
      description: null,
      roomId: null,
      teacherUserId: null,
      syllabusItemId: null,
      meetingUrl: null,
    })
    expect(planLessonPatch(lesson, values({ descriptionEn: 'Intro', deliveryMode: 'recorded' }))).toEqual({ description: { ar: 'مقدمة', en: 'Intro', tr: 'Giriş' }, deliveryMode: 'recorded' })
    // 15:00 in Riyadh: the end alone moves.
    expect(planLessonPatch(lesson, values({ endTime: '15:00' }))).toEqual({ endsAt: '2026-11-10T12:00:00.000Z' })
    expect(planLessonPatch(lesson, values({ startTime: '12:00' }))).toEqual({ startsAt: '2026-11-10T09:00:00.000Z' })
    expect(planLessonPatch(lesson, values({ teacherUserId: undefined }))).toBeNull()
    expect(planLessonPatch(lesson, values({ teacherUserId: 'teacher-2' }))).toEqual({ teacherUserId: 'teacher-2' })
    // Instants with seconds (created through the API) survive the minute-only inputs untouched.
    const withSeconds = makeLesson({ startsAt: '2026-11-10T10:00:17.250Z', endsAt: '2026-11-10T11:30:42.000Z' })
    expect(planLessonPatch(withSeconds, lessonFormValuesOf(withSeconds))).toBeNull()
  })

  it('edits only the title of an overnight lesson on a night the clock changes (DST): its end does not move by an hour (J-F19)', () => {
    // 2026-10-25 22:00 → 2026-10-26 01:00 in Berlin (CET, +01:00), the evening the clocks went back — the lesson's zone, whatever the device's.
    const overnight = makeLesson({ startsAt: '2026-10-25T21:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z', timeZone: BERLIN })
    expect(lessonFormValuesOf(overnight)).toMatchObject({ date: '2026-10-25', startTime: '22:00', endTime: '01:00' })
    expect(planLessonPatch(overnight, { ...lessonFormValuesOf(overnight), titleAr: 'الأنواع' })).toEqual({ title: { ar: 'الأنواع', en: 'Variables and data types' } })
  })

  it('reads a moved day in the lesson’s zone: across its DST change the wall clock stays, the instant follows (J-F28)', () => {
    // Saturday 2026-10-24 10:00–11:00 in Berlin is summer time (UTC+2) …
    const summer = makeLesson({ startsAt: '2026-10-24T08:00:00.000Z', endsAt: '2026-10-24T09:00:00.000Z', timeZone: BERLIN })
    expect(lessonFormValuesOf(summer)).toMatchObject({ date: '2026-10-24', startTime: '10:00', endTime: '11:00' })
    // … Monday the 26th at the same 10:00 is winter time (UTC+1): 09:00 UTC, not two days of 24 hours later (08:00 UTC).
    expect(planLessonPatch(summer, { ...lessonFormValuesOf(summer), date: '2026-10-26' })).toEqual({ startsAt: '2026-10-26T09:00:00.000Z', endsAt: '2026-10-26T10:00:00.000Z' })
    // A time the change skips (02:30 on 2026-03-29) moves forward to 03:30 summer time, as the server's generation does.
    expect(planLessonPatch(summer, { ...lessonFormValuesOf(summer), date: '2026-03-29', startTime: '02:30', endTime: '04:00' })).toEqual({
      startsAt: '2026-03-29T01:30:00.000Z',
      endsAt: '2026-03-29T02:00:00.000Z',
    })
  })

  it('rolls an end time earlier than the start to the next day of the lesson’s zone, across its own midnight (J-F19, J-F28)', () => {
    // 21:00–22:00 on the 10th in UTC+14 (07:00–08:00 UTC); an end at 00:30 is 00:30 on the 11th there — 10:30 UTC on the 10th.
    const far = makeLesson({ startsAt: '2026-11-10T07:00:00.000Z', endsAt: '2026-11-10T08:00:00.000Z', timeZone: FAR_TIME_ZONE })
    expect(lessonFormValuesOf(far)).toMatchObject({ date: '2026-11-10', startTime: '21:00', endTime: '22:00' })
    expect(planLessonPatch(far, { ...lessonFormValuesOf(far), endTime: '00:30' })).toEqual({ endsAt: '2026-11-10T10:30:00.000Z' })
  })

  it('keeps the instants of a lesson whose time occurs twice (the night the clocks go back) unless its time fields change (J-F28)', () => {
    // New York, 2026-11-01: the second 01:30 (EST, 06:30 UTC) — typed back, 01:30 resolves to the first one, as on the server.
    const repeated = makeLesson({ startsAt: '2026-11-01T06:30:00.000Z', endsAt: '2026-11-01T07:30:00.000Z', timeZone: NEW_YORK })
    expect(lessonFormValuesOf(repeated)).toMatchObject({ date: '2026-11-01', startTime: '01:30', endTime: '02:30' })
    expect(planLessonPatch(repeated, { ...lessonFormValuesOf(repeated), titleAr: 'الأنواع' })).toEqual({ title: { ar: 'الأنواع', en: 'Variables and data types' } })
    // Berlin, 2026-10-25: the first 02:30 (summer time, 00:30 UTC); a new end alone sends the end only.
    const first = makeLesson({ startsAt: '2026-10-25T00:30:00.000Z', endsAt: '2026-10-25T02:30:00.000Z', timeZone: BERLIN })
    expect(lessonFormValuesOf(first)).toMatchObject({ date: '2026-10-25', startTime: '02:30', endTime: '03:30' })
    expect(planLessonPatch(first, { ...lessonFormValuesOf(first), titleAr: 'الأنواع' })).toEqual({ title: { ar: 'الأنواع', en: 'Variables and data types' } })
    expect(planLessonPatch(first, { ...lessonFormValuesOf(first), endTime: '04:00' })).toEqual({ endsAt: '2026-10-25T03:00:00.000Z' })
  })

  it('accepts a blank or https meeting link only', () => {
    expect(isMeetingUrlValid(undefined)).toBe(true)
    expect(isMeetingUrlValid('  ')).toBe(true)
    expect(isMeetingUrlValid('https://meet.example.com/a?b=1')).toBe(true)
    expect(isMeetingUrlValid('http://meet.example.com/a')).toBe(false)
    expect(isMeetingUrlValid('https://meet example.com')).toBe(false)
  })
})
