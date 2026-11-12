import { describe, expect, it } from 'vitest'
import { SYLLABUS_ITEM_IDS } from '../test/courses'
import { FAR_TIME_ZONE, LESSON_TIME_ZONE, makeLesson } from '../test/lessons'
import { withTimeZone } from '../test/time-zone'
import { BRANCH_ID, ROOM_ID } from '../test/timetable'
import {
  NO_TEACHER,
  buildCreateLessonInput,
  editZoneOf,
  isMeetingUrlValid,
  lessonFormHasChanges,
  lessonFormValuesOf,
  lessonTimesIn,
  planLessonPatch,
  retimedFields,
} from './lessons.form'
import type { LessonFormValues } from './lessons.form'
import type { LessonZone } from './lessons.format'

const BERLIN = 'Europe/Berlin'
const NEW_YORK = 'America/New_York'
const ACADEMY: LessonZone = { timeZone: LESSON_TIME_ZONE, source: 'academy' }
const BERLIN_ROOM_ID = 'room-berlin'
/** A lesson's view of a room of the Berlin branch. */
const BERLIN_ROOM = { id: BERLIN_ROOM_ID, code: 'BER-1', name: null, branch: { id: BRANCH_ID, code: 'BER', name: { ar: 'فرع برلين' } } }

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

  it('types an edit in the zone the server will give the lesson: its own while the room stays, else the new room’s, else the academy’s (D-R41 — J-F48)', () => {
    const berlinLesson = makeLesson({ room: BERLIN_ROOM, timeZone: BERLIN })
    // Untouched, or the same room picked again: the lesson's own zone.
    expect(editZoneOf(berlinLesson, null, ACADEMY)).toEqual({ timeZone: BERLIN, source: 'lesson' })
    expect(editZoneOf(berlinLesson, { id: BERLIN_ROOM_ID, room: { timeZone: BERLIN } }, ACADEMY)).toEqual({ timeZone: BERLIN, source: 'lesson' })
    // Another room: the zone its RoomDto names (CH-0189) — the site's room is in the academy's.
    expect(editZoneOf(berlinLesson, { id: ROOM_ID, room: { timeZone: LESSON_TIME_ZONE } }, ACADEMY)).toEqual({ timeZone: LESSON_TIME_ZONE, source: 'room' })
    expect(editZoneOf(lesson, { id: BERLIN_ROOM_ID, room: { timeZone: BERLIN } }, ACADEMY)).toEqual({ timeZone: BERLIN, source: 'room' })
    // No room any more (or a room read without its zone): the academy's — this device's when the academy could not be read.
    expect(editZoneOf(berlinLesson, { id: undefined, room: undefined }, ACADEMY)).toEqual(ACADEMY)
    expect(editZoneOf(berlinLesson, { id: ROOM_ID, room: undefined }, ACADEMY)).toEqual(ACADEMY)
    expect(editZoneOf(berlinLesson, { id: undefined, room: undefined }, { timeZone: FAR_TIME_ZONE, source: 'device' })).toEqual({ timeZone: FAR_TIME_ZONE, source: 'device' })
    // A lesson without a room stays in its own zone while none is picked.
    const roomless = makeLesson({ room: null })
    expect(editZoneOf(roomless, { id: undefined, room: undefined }, { timeZone: FAR_TIME_ZONE, source: 'academy' })).toEqual({ timeZone: LESSON_TIME_ZONE, source: 'lesson' })
  })

  it('moves the times the user did not edit to the new zone’s clock of the same instants, and keeps an edited one as typed (J-F48)', () => {
    // The owner's example: 2026-11-20 10:00–14:00 in Riyadh (07:00–11:00 UTC) moved into a Berlin room — 08:00–12:00 there.
    const riyadh = makeLesson({ startsAt: '2026-11-20T07:00:00.000Z', endsAt: '2026-11-20T11:00:00.000Z' })
    const loaded = lessonTimesIn(riyadh, LESSON_TIME_ZONE)
    expect(loaded).toEqual({ date: '2026-11-20', startTime: '10:00', endTime: '14:00' })
    expect(retimedFields(riyadh, loaded, LESSON_TIME_ZONE, BERLIN)).toEqual({ startTime: '08:00', endTime: '12:00' })
    // An edited start keeps its wall clock (read in Berlin at the save); the untouched end still moves.
    expect(retimedFields(riyadh, { ...loaded, startTime: '11:00' }, LESSON_TIME_ZONE, BERLIN)).toEqual({ endTime: '12:00' })
    // An edited day is an edited start: the start time stays with it.
    expect(retimedFields(riyadh, { ...loaded, date: '2026-11-21' }, LESSON_TIME_ZONE, BERLIN)).toEqual({ endTime: '12:00' })
    expect(retimedFields(riyadh, { ...loaded, endTime: '15:00' }, LESSON_TIME_ZONE, BERLIN)).toEqual({ startTime: '08:00' })
    // The day follows the instant: 01:00 on the 21st in Riyadh is 23:00 on the 20th in Berlin.
    const night = makeLesson({ startsAt: '2026-11-20T22:00:00.000Z', endsAt: '2026-11-20T23:30:00.000Z' })
    expect(retimedFields(night, lessonTimesIn(night, LESSON_TIME_ZONE), LESSON_TIME_ZONE, BERLIN)).toEqual({ date: '2026-11-20', startTime: '23:00', endTime: '00:30' })
    // The same zone, or one of its aliases, moves nothing.
    expect(retimedFields(riyadh, loaded, LESSON_TIME_ZONE, LESSON_TIME_ZONE)).toBeNull()
    expect(retimedFields(riyadh, lessonTimesIn(riyadh, 'UTC'), 'UTC', 'Etc/UTC')).toBeNull()
  })

  it('reads an edited time in the new room’s zone and sends no instant for an untouched one — the owner’s 11:00 in Berlin is 10:00 UTC (J-F48)', () => {
    const riyadh = makeLesson({ startsAt: '2026-11-20T07:00:00.000Z', endsAt: '2026-11-20T11:00:00.000Z' })
    const inBerlin = { ...lessonFormValuesOf(riyadh), ...retimedFields(riyadh, lessonTimesIn(riyadh, LESSON_TIME_ZONE), LESSON_TIME_ZONE, BERLIN), roomId: BERLIN_ROOM_ID }
    // Moved without touching the time: the room alone travels, the lesson keeps its instants.
    expect(planLessonPatch(riyadh, inBerlin, BERLIN)).toEqual({ roomId: BERLIN_ROOM_ID })
    // Its start set to 11:00 (Berlin): 10:00 UTC — not the 08:00 UTC of 11:00 in Riyadh; the end did not move.
    expect(planLessonPatch(riyadh, { ...inBerlin, startTime: '11:00' }, BERLIN)).toEqual({ startsAt: '2026-11-20T10:00:00.000Z', roomId: BERLIN_ROOM_ID })
    expect(planLessonPatch(riyadh, { ...inBerlin, startTime: '11:00' }, LESSON_TIME_ZONE)).toMatchObject({ startsAt: '2026-11-20T08:00:00.000Z' })
    // Both times set: both read in Berlin.
    expect(planLessonPatch(riyadh, { ...inBerlin, startTime: '11:00', endTime: '12:30' }, BERLIN)).toEqual({
      startsAt: '2026-11-20T10:00:00.000Z',
      endsAt: '2026-11-20T11:30:00.000Z',
      roomId: BERLIN_ROOM_ID,
    })
    // A time that occurs twice (Berlin's 02:30 on 2026-10-25, its first — summer — occurrence) moved to Riyadh untouched:
    // 03:30 there, and no instant travels, so it is never shifted to the other occurrence.
    const repeated = makeLesson({ startsAt: '2026-10-25T00:30:00.000Z', endsAt: '2026-10-25T02:30:00.000Z', room: BERLIN_ROOM, timeZone: BERLIN })
    const moved = { ...lessonFormValuesOf(repeated), ...retimedFields(repeated, lessonFormValuesOf(repeated), BERLIN, LESSON_TIME_ZONE), roomId: ROOM_ID }
    expect(moved).toMatchObject({ date: '2026-10-25', startTime: '03:30', endTime: '05:30' })
    expect(planLessonPatch(repeated, moved, LESSON_TIME_ZONE)).toEqual({ roomId: ROOM_ID })
  })

  it('holds the room alone after a move with the times untouched, and nothing once the room is chosen back (KI-058 — J-F48)', () => {
    const riyadh = makeLesson({ startsAt: '2026-11-20T07:00:00.000Z', endsAt: '2026-11-20T11:00:00.000Z' })
    const values = lessonFormValuesOf(riyadh)
    const inBerlin = { ...values, ...retimedFields(riyadh, values, LESSON_TIME_ZONE, BERLIN), roomId: BERLIN_ROOM_ID }
    expect(lessonFormHasChanges(riyadh, inBerlin, BERLIN)).toBe(true)
    // Back in its room: the lesson's clock again — nothing is held.
    const back = { ...inBerlin, ...retimedFields(riyadh, inBerlin, BERLIN, LESSON_TIME_ZONE), roomId: ROOM_ID }
    expect(back).toEqual(values)
    expect(lessonFormHasChanges(riyadh, back, LESSON_TIME_ZONE)).toBe(false)
  })

  it('holds nothing while the edit form matches the lesson: opened untouched, changed back, or only spaces around a text (KI-058 — J-F40)', () => {
    expect(lessonFormHasChanges(lesson, values())).toBe(false)
    expect(lessonFormHasChanges(lesson, values({ titleEn: ' Variables and data types ', descriptionAr: 'مقدمة ', meetingUrl: ' https://meet.example.com/a' }))).toBe(false)
    // Typed away and back: the loaded wall clock again.
    expect(lessonFormHasChanges(lesson, values({ startTime: '13:00', endTime: '14:30' }))).toBe(false)
    // Instants with seconds, or a time that occurs twice in the lesson's zone, opened untouched.
    const withSeconds = makeLesson({ startsAt: '2026-11-10T10:00:17.250Z', endsAt: '2026-11-10T11:30:42.000Z' })
    expect(lessonFormHasChanges(withSeconds, lessonFormValuesOf(withSeconds))).toBe(false)
    const repeated = makeLesson({ startsAt: '2026-11-01T06:30:00.000Z', endsAt: '2026-11-01T07:30:00.000Z', timeZone: NEW_YORK })
    expect(lessonFormHasChanges(repeated, lessonFormValuesOf(repeated))).toBe(false)
  })

  it('holds what the smallest PATCH would send, and what the save would refuse instead of sending (KI-058 — J-F40)', () => {
    for (const sent of [{ titleAr: 'الأنواع' }, { descriptionEn: 'Intro' }, { deliveryMode: 'recorded' as const }, { endTime: '15:00' }, { roomId: undefined }, { syllabusItemId: undefined }, { teacherUserId: NO_TEACHER }, { meetingUrl: '' }]) {
      expect(planLessonPatch(lesson, values(sent))).not.toBeNull()
      expect(lessonFormHasChanges(lesson, values(sent))).toBe(true)
    }
    // An emptied Arabic title (an English title alone included), day or time: planLessonPatch() sends nothing, the form refuses to save.
    for (const refused of [{ titleAr: ' ' }, { titleAr: '', titleEn: 'Types' }, { date: '' }, { startTime: '' }, { endTime: '' }]) {
      expect(planLessonPatch(lesson, values(refused))).toBeNull()
      expect(lessonFormHasChanges(lesson, values(refused))).toBe(true)
    }
    // An English description without its Arabic text, on a lesson without a description: nothing to send, yet typed work.
    const plain = makeLesson()
    const english = { ...lessonFormValuesOf(plain), descriptionEn: 'Intro' }
    expect(planLessonPatch(plain, english)).toBeNull()
    expect(lessonFormHasChanges(plain, english)).toBe(true)
    // Both description texts emptied: the PATCH clears a stored description; there is nothing to clear on a lesson without one.
    expect(lessonFormHasChanges(lesson, values({ descriptionAr: '', descriptionEn: '' }))).toBe(true)
    expect(lessonFormHasChanges(plain, { ...lessonFormValuesOf(plain), descriptionAr: ' ', descriptionEn: '' })).toBe(false)
  })

  it('accepts a blank or https meeting link only', () => {
    expect(isMeetingUrlValid(undefined)).toBe(true)
    expect(isMeetingUrlValid('  ')).toBe(true)
    expect(isMeetingUrlValid('https://meet.example.com/a?b=1')).toBe(true)
    expect(isMeetingUrlValid('http://meet.example.com/a')).toBe(false)
    expect(isMeetingUrlValid('https://meet example.com')).toBe(false)
  })
})
