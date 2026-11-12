import { describe, expect, it } from 'vitest'
import { FAR_TIME_ZONE } from '../test/lessons'
import { withTimeZone } from '../test/time-zone'
import { deviceTimeZone } from '../timetable/timetable.settings'
import {
  NEXT_DAY_MARK,
  academyZoneOf,
  dateFilterValue,
  dayEndInstant,
  dayStartInstant,
  differsFromDevice,
  durationMinutes,
  formatClock,
  formatLessonDateTime,
  formatLessonDay,
  formatLessonTimes,
  lessonRoomLabel,
  lessonZoneFor,
  nextDayRangeOf,
  rangeOf,
  rangeProblem,
  sameTimeZone,
  syllabusItemLabel,
  toInstant,
  todayIn,
  zonedPartsOf,
} from './lessons.format'

const RIYADH = 'Asia/Riyadh'
const BERLIN = 'Europe/Berlin'
const NEW_YORK = 'America/New_York'

describe('lessons.format', () => {
  it('turns an instant into the day and time of a named zone and back, whatever the browser’s zone (D-R41 — J-F28)', () => {
    const iso = '2026-11-10T10:30:00.000Z'
    expect(deviceTimeZone()).not.toBe(FAR_TIME_ZONE)
    const check = () => {
      expect(zonedPartsOf(iso, RIYADH)).toEqual({ date: '2026-11-10', time: '13:30' })
      // UTC+14: already the next day there.
      expect(zonedPartsOf(iso, FAR_TIME_ZONE)).toEqual({ date: '2026-11-11', time: '00:30' })
      expect(zonedPartsOf(iso, NEW_YORK)).toEqual({ date: '2026-11-10', time: '05:30' })
      expect(toInstant('2026-11-11', '00:30', FAR_TIME_ZONE)).toBe(iso)
      expect(toInstant('2026-11-10', '13:30', RIYADH)).toBe(iso)
    }
    check()
    // The same answers on a device on the other side of the world.
    withTimeZone('America/Los_Angeles', check)
    expect(zonedPartsOf('garbage', RIYADH)).toEqual({ date: '', time: '' })
    expect(toInstant('2026-11-10', undefined, RIYADH)).toBeUndefined()
    expect(toInstant('10/11/2026', '10:30', RIYADH)).toBeUndefined()
    expect(toInstant('2026-11-10', '10', RIYADH)).toBeUndefined()
    expect(toInstant('2026-02-30', '10:00', RIYADH)).toBeUndefined()
    expect(toInstant('2026-11-10', '24:00', RIYADH)).toBeUndefined()
  })

  it('builds the range from one day and two clock times of the zone, rolling an earlier end time to that zone’s next day', () => {
    expect(rangeOf('2026-11-10', '10:00', '11:30', RIYADH)).toEqual({ startsAt: '2026-11-10T07:00:00.000Z', endsAt: '2026-11-10T08:30:00.000Z', nextDay: false })
    const overnight = rangeOf('2026-11-10', '22:00', '01:00', RIYADH)!
    expect(durationMinutes(overnight.startsAt, overnight.endsAt)).toBe(180)
    expect(zonedPartsOf(overnight.endsAt, RIYADH)).toEqual({ date: '2026-11-11', time: '01:00' })
    expect(overnight.nextDay).toBe(true)
    // Midnight of the lesson's zone, not of the device: 23:00 → 00:30 in UTC+14 is one UTC morning (J-F28).
    expect(rangeOf('2026-11-10', '23:00', '00:30', FAR_TIME_ZONE)).toEqual({ startsAt: '2026-11-10T09:00:00.000Z', endsAt: '2026-11-10T10:30:00.000Z', nextDay: true })
    expect(rangeOf('2026-11-10', '10:00', undefined, RIYADH)).toBeUndefined()
    expect(rangeOf(undefined, '10:00', '11:00', RIYADH)).toBeUndefined()
  })

  it('marks only a real next-day end for the form: not a same-day end, not an end equal to the start, not a missing part (J-F19)', () => {
    // The typo the owner described: 13:00 → 01:00 is a 12-hour lesson that ends on the next day.
    const typo = nextDayRangeOf('2026-11-12', '13:00', '01:00', RIYADH)!
    expect(zonedPartsOf(typo.endsAt, RIYADH)).toEqual({ date: '2026-11-13', time: '01:00' })
    expect(durationMinutes(typo.startsAt, typo.endsAt)).toBe(720)
    expect(rangeProblem(typo.startsAt, typo.endsAt)).toBeNull()
    expect(nextDayRangeOf('2026-11-12', '13:00', '14:00', RIYADH)).toBeUndefined()
    // Equal times are refused as an empty range, never shown as a 24-hour lesson.
    expect(nextDayRangeOf('2026-11-12', '13:00', '13:00', RIYADH)).toBeUndefined()
    expect(nextDayRangeOf(undefined, '13:00', '01:00', RIYADH)).toBeUndefined()
    expect(nextDayRangeOf('2026-11-12', '13:00', undefined, RIYADH)).toBeUndefined()
    expect(NEXT_DAY_MARK).toBe('(+1)')
  })

  it('keeps the typed end time of an overnight lesson on a night the lesson’s zone changes its clock (DST): the next day’s wall clock, not 24 hours later (J-F19, J-F28)', () => {
    const check = () => {
      // 2026-10-25 in Berlin: the clocks went back at 03:00 (24 hours after the same-day 01:00 is 00:00 — 120 minutes).
      const back = rangeOf('2026-10-25', '22:00', '01:00', BERLIN)!
      expect(back).toEqual({ startsAt: '2026-10-25T21:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z', nextDay: true })
      expect(durationMinutes(back.startsAt, back.endsAt)).toBe(180)
      // 2026-03-29: the clocks went forward at 02:00 (24 hours later is 02:00 — 240 minutes).
      const forward = rangeOf('2026-03-29', '22:00', '01:00', BERLIN)!
      expect(zonedPartsOf(forward.endsAt, BERLIN)).toEqual({ date: '2026-03-30', time: '01:00' })
      expect(durationMinutes(forward.startsAt, forward.endsAt)).toBe(180)
      // A lesson across the change itself lasts what the clocks say plus the repeated hour.
      const across = rangeOf('2026-10-25', '01:00', '04:00', BERLIN)!
      expect(durationMinutes(across.startsAt, across.endsAt)).toBe(240)
    }
    // The lesson's zone decides, so the device's does not matter (it used to be the only one read).
    check()
    withTimeZone('Asia/Tokyo', check)
    // The end of a month and of a year roll over like any other day.
    expect(zonedPartsOf(rangeOf('2026-12-31', '23:00', '00:30', RIYADH)!.endsAt, RIYADH)).toEqual({ date: '2027-01-01', time: '00:30' })
  })

  it('mirrors the server range rule: empty, longer than 12 hours, or fine', () => {
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T10:00:00.000Z')).toBe('empty')
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T09:00:00.000Z')).toBe('empty')
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T22:00:00.000Z')).toBeNull()
    expect(rangeProblem('2026-11-10T10:00:00.000Z', '2026-11-10T22:00:01.000Z')).toBe('too_long')
    expect(rangeProblem('x', '2026-11-10T22:00:00.000Z')).toBe('empty')
    expect(durationMinutes('x', 'y')).toBe(0)
  })

  it('turns the day filters into the first and last millisecond of the day in the academy’s zone, 23- and 25-hour days included (J-F28)', () => {
    expect(dayStartInstant('2026-11-10', RIYADH)).toBe('2026-11-09T21:00:00.000Z')
    expect(dayEndInstant('2026-11-10', RIYADH)).toBe('2026-11-10T20:59:59.999Z')
    expect(dayStartInstant('2026-11-10', FAR_TIME_ZONE)).toBe('2026-11-09T10:00:00.000Z')
    expect(dayEndInstant('2026-11-10', FAR_TIME_ZONE)).toBe('2026-11-10T09:59:59.999Z')
    // Berlin goes back an hour on 2026-10-25 (25 hours) and forward on 2026-03-29 (23 hours).
    expect(dayStartInstant('2026-10-25', BERLIN)).toBe('2026-10-24T22:00:00.000Z')
    expect(dayEndInstant('2026-10-25', BERLIN)).toBe('2026-10-25T22:59:59.999Z')
    expect(dayStartInstant('2026-03-29', BERLIN)).toBe('2026-03-28T23:00:00.000Z')
    expect(dayEndInstant('2026-03-29', BERLIN)).toBe('2026-03-29T21:59:59.999Z')
    expect(dayStartInstant(undefined, RIYADH)).toBeUndefined()
    expect(dayEndInstant('', RIYADH)).toBeUndefined()
    expect(dayEndInstant('2026-02-30', RIYADH)).toBeUndefined()
    // «Today» is the zone's day: 22:30Z on the 10th is already the 11th in Riyadh.
    const lateEvening = new Date(Date.UTC(2026, 10, 10, 22, 30))
    expect(todayIn(RIYADH, lateEvening)).toBe('2026-11-11')
    expect(todayIn('UTC', lateEvening)).toBe('2026-11-10')
    expect(todayIn(NEW_YORK, lateEvening)).toBe('2026-11-10')
  })

  it('keeps a real day for a day filter and treats a blank or malformed value as empty (J-F25)', () => {
    expect(dateFilterValue('2026-11-10')).toBe('2026-11-10')
    expect(dateFilterValue('2028-02-29')).toBe('2028-02-29')
    // What a browser that renders the date input as a plain text field can hand over.
    for (const raw of ['', '2026-02-30', '2026-13-01', '2026-11-7', '10/11/2026', 'غداً']) expect(dateFilterValue(raw)).toBeUndefined()
  })

  it('formats times in the lesson’s zone with Latin digits and a 24-hour clock, marking an end on that zone’s next day', () => {
    const start = '2026-11-10T09:05:00.000Z'
    const end = '2026-11-10T11:30:00.000Z'
    expect(formatClock(start, 'ar', 'UTC')).toBe('09:05')
    expect(formatClock(end, 'en', 'UTC')).toBe('11:30')
    expect(formatLessonTimes(start, end, 'ar', 'UTC')).toBe('09:05 – 11:30')
    expect(formatLessonTimes(start, end, 'ar', RIYADH)).toBe('12:05 – 14:30')
    expect(formatLessonTimes('2026-11-10T19:00:00.000Z', '2026-11-10T22:00:00.000Z', 'en', RIYADH)).toBe('22:00 – 01:00 (+1)')
    // One UTC morning, but across midnight in UTC+14 — the mark follows the lesson's zone (J-F28).
    expect(formatLessonTimes('2026-11-10T09:00:00.000Z', '2026-11-10T10:30:00.000Z', 'en', FAR_TIME_ZONE)).toBe('23:00 – 00:30 (+1)')
    expect(formatLessonDay('2026-11-10T10:30:00.000Z', 'en', FAR_TIME_ZONE)).toBe('11 Nov 2026')
    expect(formatLessonDay('2026-11-10T10:30:00.000Z', 'en', 'UTC')).toBe('10 Nov 2026')
    expect(formatLessonDateTime('2026-11-10T10:30:00.000Z', 'en', FAR_TIME_ZONE)).toBe('11 Nov 2026, 00:30')
    expect(formatLessonDateTime(null, 'ar', RIYADH)).toBe('—')
    expect(formatClock('garbage', 'ar', RIYADH)).toBe('garbage')
    // An unknown name reads as UTC, as zonedInstant() does, so the form and the display agree.
    expect(formatClock(start, 'en', 'Mars/Base')).toBe('09:05')
  })

  it('tells when a zone is not the device’s (an alias is the same zone) and picks the academy’s zone, else the device’s (D-R41)', () => {
    expect(sameTimeZone(RIYADH, RIYADH)).toBe(true)
    expect(sameTimeZone('UTC', 'Etc/UTC')).toBe(true)
    expect(sameTimeZone('Asia/Kolkata', 'Asia/Calcutta')).toBe(true)
    // Same offset today, other zones: the screens name both.
    expect(sameTimeZone(RIYADH, 'Europe/Istanbul')).toBe(false)
    expect(differsFromDevice(deviceTimeZone())).toBe(false)
    expect(differsFromDevice(FAR_TIME_ZONE)).toBe(true)
    expect(differsFromDevice('Europe/Istanbul', 'Europe/Istanbul')).toBe(false)
    expect(academyZoneOf({ timezone: 'Europe/Istanbul' })).toEqual({ timeZone: 'Europe/Istanbul', source: 'academy' })
    expect(academyZoneOf(null)).toEqual({ timeZone: deviceTimeZone(), source: 'device' })
    expect(academyZoneOf({ timezone: 'Mars/Base' })).toEqual({ timeZone: deviceTimeZone(), source: 'device' })
  })

  it('gives a lesson the zone of its room — RoomDto timeZone — else the academy’s, as the server does (D-R41 — J-F48)', () => {
    const academy = { timeZone: RIYADH, source: 'academy' } as const
    expect(lessonZoneFor({ timeZone: BERLIN }, academy)).toEqual({ timeZone: BERLIN, source: 'room' })
    // A room of the site carries the academy's zone: it is still the room's.
    expect(lessonZoneFor({ timeZone: RIYADH }, academy)).toEqual({ timeZone: RIYADH, source: 'room' })
    // No room: the academy's (this device's when the academy could not be read).
    expect(lessonZoneFor(null, academy)).toBe(academy)
    expect(lessonZoneFor(undefined, { timeZone: FAR_TIME_ZONE, source: 'device' })).toEqual({ timeZone: FAR_TIME_ZONE, source: 'device' })
    // A room read without a usable zone (a server before CH-0189, or an unknown name): the academy's.
    expect(lessonZoneFor({}, academy)).toBe(academy)
    expect(lessonZoneFor({ timeZone: 'Mars/Base' }, academy)).toBe(academy)
  })

  it('labels rooms and syllabus items like the schedule and syllabus screens', () => {
    expect(lessonRoomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'ar')).toBe('LAB-1 — مختبر 1')
    expect(lessonRoomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'en')).toBe('LAB-1 — Lab 1')
    expect(lessonRoomLabel({ code: 'HALL', name: null }, 'ar')).toBe('HALL')
    expect(syllabusItemLabel({ sortOrder: 2, title: { ar: 'الحلقات', en: 'Loops' } }, 'en')).toBe('3. Loops')
    expect(syllabusItemLabel({ sortOrder: 0, title: { ar: 'المتغيرات' } }, 'en')).toBe('1. المتغيرات')
  })
})
