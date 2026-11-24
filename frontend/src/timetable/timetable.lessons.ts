// The learner's real lessons on «my schedule» (J-F65, KI-064), pure and
// unit-tested in timetable.lessons.test.ts. API-091 answers weekly slots only,
// so a class whose lessons were added by hand showed an empty calendar. API-101
// answers the dated lessons: each becomes one entry on the day it starts in its
// own zone, one card per lesson however many of the caller's children attend.
// A lesson replaces the weekly slot of its class that starts at the same
// instant (the lesson generated from that slot): API-101 does not send the
// lesson's `scheduleId`, so a generated lesson moved to another time leaves its
// slot on the calendar at the original time.
import type { MyLessonItem } from '../api/myLessons'
import { calendarDateIn, clockOfMinutes, minutesNowIn, weekdayOf, zonedInstant } from './timetable.dates'
import type { CalendarDate } from './timetable.dates'
import { compareEntries } from './timetable.model'
import type { TimetableEntry } from './timetable.model'

const HOUR = 3_600_000
const DAY_MINUTES = 24 * 60

/**
 * The instants that hold every lesson starting on `date` in any zone: from
 * midnight at UTC+14 to the end of the day at UTC−12. The answer is narrowed
 * by `lessonEntriesOn()`, each lesson by its own zone.
 */
export function lessonDayWindow(date: CalendarDate): { from: string; to: string } {
  const midnight = Date.parse(`${date}T00:00:00Z`)
  return { from: new Date(midnight - 14 * HOUR).toISOString(), to: new Date(midnight + 36 * HOUR).toISOString() }
}

function entryOfLesson(item: MyLessonItem, date: CalendarDate): TimetableEntry {
  const startsAt = Date.parse(item.startsAt)
  const endsAt = Date.parse(item.endsAt)
  const startMinutes = minutesNowIn(item.timeZone, startsAt)
  const endClock = minutesNowIn(item.timeZone, endsAt)
  // The grid holds one day: a lesson past midnight runs to the end of its column and keeps its real end time as text.
  const wallEnd = calendarDateIn(item.timeZone, endsAt) === date ? endClock : DAY_MINUTES
  // A repeated daylight-saving hour can put the wall-clock end before the start: the real length decides.
  const endMinutes = wallEnd > startMinutes ? wallEnd : Math.min(DAY_MINUTES, startMinutes + Math.max(1, Math.round((endsAt - startsAt) / 60_000)))
  return {
    id: item.id,
    weekday: weekdayOf(date),
    startTime: clockOfMinutes(startMinutes),
    endTime: clockOfMinutes(endClock),
    startMinutes,
    endMinutes,
    timeZone: item.timeZone,
    effectiveFrom: date,
    effectiveTo: date,
    class: item.class,
    room: item.room,
    teacher: item.teacher,
    relations: [],
    lesson: { title: item.title, status: item.status, deliveryMode: item.deliveryMode, meetingUrl: item.meetingUrl, startsAt: item.startsAt, endsAt: item.endsAt },
  }
}

/** One entry per lesson that starts on `date` in its own zone, its relations in the server's order. */
export function lessonEntriesOn(items: readonly MyLessonItem[], date: CalendarDate): TimetableEntry[] {
  const byLesson = new Map<string, TimetableEntry>()
  for (const item of items) {
    if (calendarDateIn(item.timeZone, Date.parse(item.startsAt)) !== date) continue
    let entry = byLesson.get(item.id)
    if (!entry) {
      entry = entryOfLesson(item, date)
      byLesson.set(item.id, entry)
    }
    if (!entry.relations.some((known) => known.relation === item.relation && known.student?.id === item.student.id)) {
      entry.relations.push({ relation: item.relation, student: item.student })
    }
  }
  return [...byLesson.values()]
}

/** The day's cards: its lessons and the weekly slots no lesson of the same class replaces, in display order. */
export function mergeLessons(slots: readonly TimetableEntry[], lessons: readonly TimetableEntry[], date: CalendarDate): TimetableEntry[] {
  const held = new Set(lessons.map((entry) => `${entry.class.id}|${Date.parse(entry.lesson!.startsAt)}`))
  const open = slots.filter((slot) => !held.has(`${slot.class.id}|${zonedInstant(date, slot.startTime, slot.timeZone)}`))
  return [...open, ...lessons].sort(compareEntries)
}
