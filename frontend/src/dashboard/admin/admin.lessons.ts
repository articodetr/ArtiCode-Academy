// What the «الجدول الدراسي» card of the admin home lists (J-F59). No request and no React here — admin.lessons.test.ts.
import type { Lesson } from '../../api/lessons'
import type { CalendarDate } from '../../timetable/timetable.dates'
import { wallDate } from '../dashboard.data'

export type ScheduleView = 'day' | 'week'

/** How many days each view reads, from today (the academy's day). */
export const VIEW_DAYS: Readonly<Record<ScheduleView, number>> = { day: 1, week: 7 }

/** How many coming lessons the week view lists before pointing to /lessons. */
export const WEEK_LESSONS_SHOWN = 12

/** The lessons a view lists: all of today's (with their state), or the next ones of the week that have not ended. */
export function lessonsToShow(lessons: readonly Lesson[], view: ScheduleView, now: number): Lesson[] {
  const sorted = [...lessons].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  if (view === 'day') return sorted
  return sorted.filter((lesson) => Date.parse(lesson.endsAt) > now).slice(0, WEEK_LESSONS_SHOWN)
}

/** Lessons grouped by their day in `zone` (the academy's), in order. */
export function byDay(lessons: readonly Lesson[], zone: string): Array<{ date: CalendarDate; lessons: Lesson[] }> {
  const groups: Array<{ date: CalendarDate; lessons: Lesson[] }> = []
  for (const lesson of lessons) {
    const date = wallDate(lesson.startsAt, zone)
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.lessons.push(lesson)
    else groups.push({ date, lessons: [lesson] })
  }
  return groups
}
