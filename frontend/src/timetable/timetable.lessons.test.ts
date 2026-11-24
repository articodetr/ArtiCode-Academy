import { describe, expect, it } from 'vitest'
import { LESSON_ID, STUDENT_ID, makeCalendarLesson, makeMyItem } from '../test/timetable'
import { lessonDayWindow, lessonEntriesOn, mergeLessons } from './timetable.lessons'
import { entriesOfMine, entriesOn, upcomingOccurrences } from './timetable.model'

const TUESDAY = '2026-11-10'
/** Tuesday 12:00 in Riyadh: the weekly slot a lesson of the fixture would be generated from. */
const slotsOnTuesday = (startTime = '12:00', endTime = '13:00') => entriesOn(entriesOfMine([makeMyItem({ weekday: 2, startTime, endTime })]), TUESDAY)

describe('lessonDayWindow', () => {
  it('holds the whole calendar day in every zone, from UTC+14 to UTC−12', () => {
    expect(lessonDayWindow(TUESDAY)).toEqual({ from: '2026-11-09T10:00:00.000Z', to: '2026-11-11T12:00:00.000Z' })
  })
})

describe('lessonEntriesOn', () => {
  it('makes a lesson an entry on its own date with its wall-clock times in its zone', () => {
    const [entry] = lessonEntriesOn([makeCalendarLesson()], TUESDAY)
    expect(entry).toMatchObject({ id: LESSON_ID, weekday: 2, startTime: '12:00', endTime: '13:00', startMinutes: 720, endMinutes: 780, effectiveFrom: TUESDAY, effectiveTo: TUESDAY })
    expect(entry!.lesson).toMatchObject({ status: 'scheduled', meetingUrl: 'https://meet.example.com/variables' })
  })

  it('places a lesson on the day it starts in its own zone, not the UTC day', () => {
    // 22:30Z on Monday is 01:30 on Tuesday in Riyadh.
    const lesson = makeCalendarLesson({ startsAt: '2026-11-09T22:30:00.000Z', endsAt: '2026-11-09T23:30:00.000Z' })
    expect(lessonEntriesOn([lesson], TUESDAY).map((entry) => entry.startTime)).toEqual(['01:30'])
    expect(lessonEntriesOn([lesson], '2026-11-09')).toEqual([])
  })

  it('folds one lesson of two children into one entry naming both', () => {
    const other = { id: 'k-2', fullName: 'أحمد', displayName: null }
    const entries = lessonEntriesOn([makeCalendarLesson({ relation: 'child' }), makeCalendarLesson({ relation: 'child', student: other })], TUESDAY)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.relations.map((relation) => relation.student?.id)).toEqual([STUDENT_ID, 'k-2'])
  })

  it('runs a lesson past midnight to the end of its column and keeps its real end time', () => {
    // 23:00 Tuesday → 01:00 Wednesday in Riyadh.
    const lesson = makeCalendarLesson({ startsAt: '2026-11-10T20:00:00.000Z', endsAt: '2026-11-10T22:00:00.000Z' })
    expect(lessonEntriesOn([lesson], TUESDAY)[0]).toMatchObject({ startTime: '23:00', endTime: '01:00', startMinutes: 1380, endMinutes: 1440 })
  })
})

describe('mergeLessons', () => {
  it('shows a lesson added by hand when the class has no weekly slot', () => {
    expect(mergeLessons([], lessonEntriesOn([makeCalendarLesson()], TUESDAY), TUESDAY).map((entry) => entry.id)).toEqual([LESSON_ID])
  })

  it('replaces the weekly slot its lesson was generated from, so the card is not doubled', () => {
    expect(mergeLessons(slotsOnTuesday(), lessonEntriesOn([makeCalendarLesson()], TUESDAY), TUESDAY).map((entry) => entry.id)).toEqual([LESSON_ID])
  })

  it('a cancelled lesson also replaces its slot: the day shows the cancellation', () => {
    const merged = mergeLessons(slotsOnTuesday(), lessonEntriesOn([makeCalendarLesson({ status: 'cancelled' })], TUESDAY), TUESDAY)
    expect(merged.map((entry) => entry.lesson?.status)).toEqual(['cancelled'])
  })

  it('keeps a slot at another time and a slot of another class, in time order', () => {
    const earlier = slotsOnTuesday('10:00', '11:00')
    const otherClass = entriesOn(entriesOfMine([makeMyItem({ id: 'other', weekday: 2, startTime: '12:00', endTime: '13:00', class: { ...makeMyItem().class, id: 'class-2', code: 'ZZ-1' } })]), TUESDAY)
    const merged = mergeLessons([...earlier, ...otherClass], lessonEntriesOn([makeCalendarLesson()], TUESDAY), TUESDAY)
    expect(merged.map((entry) => entry.id)).toEqual([earlier[0]!.id, LESSON_ID, 'other'])
  })
})

describe('upcomingOccurrences with lessons', () => {
  const now = Date.parse('2026-11-10T08:00:00.000Z')
  const upcomingOf = (status: 'scheduled' | 'cancelled' | 'completed') =>
    upcomingOccurrences(new Map([[TUESDAY, lessonEntriesOn([makeCalendarLesson({ status })], TUESDAY)]]), [TUESDAY], now, 5)

  it('lists a scheduled lesson by its own instants', () => {
    expect(upcomingOf('scheduled').map((occurrence) => occurrence.startsAt)).toEqual([Date.parse('2026-11-10T09:00:00.000Z')])
  })

  it('leaves out a cancelled or completed lesson', () => {
    expect(upcomingOf('cancelled')).toEqual([])
    expect(upcomingOf('completed')).toEqual([])
  })

  it('counts a lesson past midnight as running until its real end', () => {
    const lesson = makeCalendarLesson({ startsAt: '2026-11-10T20:00:00.000Z', endsAt: '2026-11-10T22:00:00.000Z' })
    const late = Date.parse('2026-11-10T21:30:00.000Z')
    expect(upcomingOccurrences(new Map([[TUESDAY, lessonEntriesOn([lesson], TUESDAY)]]), [TUESDAY], late, 5)).toHaveLength(1)
  })
})
