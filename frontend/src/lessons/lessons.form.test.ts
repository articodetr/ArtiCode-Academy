import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS } from '../test/courses'
import { makeLesson } from '../test/lessons'
import { withTimeZone } from '../test/time-zone'
import { ROOM_ID } from '../test/timetable'
import { NO_TEACHER, buildCreateLessonInput, isMeetingUrlValid, lessonFormValuesOf, planLessonPatch } from './lessons.form'
import type { LessonFormValues } from './lessons.form'
import { localPartsOf, rangeOf } from './lessons.format'

const lesson = makeLesson({ description: { ar: 'مقدمة', tr: 'Giriş' }, meetingUrl: 'https://meet.example.com/a' })
const start = localPartsOf(lesson.startsAt)
const end = localPartsOf(lesson.endsAt)

function values(overrides: Partial<LessonFormValues> = {}): LessonFormValues {
  return { ...lessonFormValuesOf(lesson), ...overrides }
}

describe('lessons.form', () => {
  it('derives the form values from a lesson: local day and times, the current links, NO_TEACHER for none', () => {
    expect(lessonFormValuesOf(lesson)).toEqual({
      classId: lesson.class.id,
      titleAr: 'المتغيرات وأنواع البيانات',
      titleEn: 'Variables and data types',
      descriptionAr: 'مقدمة',
      descriptionEn: '',
      deliveryMode: 'in_person',
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      roomId: ROOM_ID,
      teacherUserId: lesson.teacher!.userId,
      syllabusItemId: SYLLABUS_ITEM_IDS[0],
      meetingUrl: 'https://meet.example.com/a',
    })
    expect(lessonFormValuesOf(makeLesson({ teacher: null, room: null, syllabusItem: null })).teacherUserId).toBe(NO_TEACHER)
    expect(lessonFormValuesOf(makeLesson({ teacher: null, room: null, syllabusItem: null })).roomId).toBeUndefined()
  })

  it('builds the create body with what was filled in: the default teacher is left to the server, NO_TEACHER travels as null', () => {
    const range = rangeOf('2026-11-12', '09:00', '10:30')!
    expect(buildCreateLessonInput({ titleAr: ' الدوال ', deliveryMode: 'live_online', date: '2026-11-12', startTime: '09:00', endTime: '10:30', meetingUrl: ' https://meet.example.com/b ' })).toEqual({
      title: { ar: 'الدوال' },
      deliveryMode: 'live_online',
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      meetingUrl: 'https://meet.example.com/b',
    })
    expect(
      buildCreateLessonInput({
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
      }),
    ).toEqual({
      title: { ar: 'الدوال', en: 'Functions' },
      description: { ar: 'وصف' },
      deliveryMode: 'in_person',
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      roomId: ROOM_ID,
      teacherUserId: null,
      syllabusItemId: SYLLABUS_ITEM_IDS[1],
    })
    expect(buildCreateLessonInput({ titleAr: 'x', deliveryMode: 'hybrid', date: '2026-11-12', startTime: '09:00', endTime: '10:30', teacherUserId: 'teacher-2' }).teacherUserId).toBe('teacher-2')
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
    const moved = rangeOf(start.date, start.time, '12:00')!
    expect(planLessonPatch(lesson, values({ endTime: '12:00' }))).toEqual({ endsAt: moved.endsAt })
    expect(planLessonPatch(lesson, values({ teacherUserId: undefined }))).toBeNull()
    expect(planLessonPatch(lesson, values({ teacherUserId: 'teacher-2' }))).toEqual({ teacherUserId: 'teacher-2' })
    // Instants with seconds (created through the API) survive the minute-only inputs untouched.
    const withSeconds = makeLesson({ startsAt: '2026-11-10T10:00:17.250Z', endsAt: '2026-11-10T11:30:42.000Z' })
    expect(planLessonPatch(withSeconds, lessonFormValuesOf(withSeconds))).toBeNull()
  })

  it('edits only the title of an overnight lesson on a night the clock changes (DST): its end does not move by an hour (J-F19)', () => {
    withTimeZone('Europe/Berlin', () => {
      expect(new Date('2026-07-01T12:00:00Z').getTimezoneOffset()).toBe(-120)
      // 2026-10-25 22:00 → 2026-10-26 01:00 in Berlin (CET, +01:00), the evening the clocks went back.
      const overnight = makeLesson({ startsAt: '2026-10-25T21:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z' })
      expect(lessonFormValuesOf(overnight)).toMatchObject({ date: '2026-10-25', startTime: '22:00', endTime: '01:00' })
      expect(planLessonPatch(overnight, { ...lessonFormValuesOf(overnight), titleAr: 'الأنواع' })).toEqual({ title: { ar: 'الأنواع', en: 'Variables and data types' } })
    })
  })

  it('accepts a blank or https meeting link only', () => {
    expect(isMeetingUrlValid(undefined)).toBe(true)
    expect(isMeetingUrlValid('  ')).toBe(true)
    expect(isMeetingUrlValid('https://meet.example.com/a?b=1')).toBe(true)
    expect(isMeetingUrlValid('http://meet.example.com/a')).toBe(false)
    expect(isMeetingUrlValid('https://meet example.com')).toBe(false)
  })
})
