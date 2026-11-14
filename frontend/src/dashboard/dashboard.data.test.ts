import { describe, expect, it } from 'vitest'
import type { AcademyClass } from '../api/classes'
import type { Lesson } from '../api/lessons'
import type { ReportsOverview } from '../api/reports'
import {
  attentionItems,
  busyMinutes,
  dayWindow,
  formatMoney,
  hoursOf,
  labelIn,
  lanesByRoom,
  lanesByTeacher,
  lessonState,
  monthsBack,
  nowOffset,
  packRows,
  place,
  visibleViews,
} from './dashboard.data'

const ZONE = 'Europe/Istanbul'
const at = (hhmm: string, day = '2026-11-14') => new Date(`${day}T${hhmm}:00+03:00`).toISOString()

function lesson(id: string, from: string, to: string, extra: Partial<Lesson> = {}): Lesson {
  return {
    id,
    class: { id: `c-${id}`, code: 'C', name: { ar: 'فصل', en: 'Class' }, status: 'running', course: { id: 'co', code: 'CO', name: { ar: 'دورة' } } },
    title: { ar: 'درس' },
    description: null,
    deliveryMode: 'in_person',
    startsAt: at(from),
    endsAt: at(to),
    status: 'scheduled',
    room: null,
    timeZone: ZONE,
    teacher: null,
    syllabusItem: null,
    scheduleId: null,
    meetingUrl: null,
    cancellationReason: null,
    attendanceTakenAt: null,
    attendance: { present: 0, late: 0, absent: 0, excused: 0 },
    createdAt: at('08:00'),
    updatedAt: at('08:00'),
    ...extra,
  } as Lesson
}

describe('dashboard timeline rules', () => {
  it('shows 09–20 at least and widens to whole hours around the lessons', () => {
    expect(dayWindow([], ZONE)).toEqual({ start: 9 * 60, end: 20 * 60 })
    const window = dayWindow([lesson('a', '07:30', '08:15'), lesson('b', '20:10', '21:40')], ZONE)
    expect(window).toEqual({ start: 7 * 60, end: 22 * 60 })
    expect(hoursOf(window)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
  })

  it('places a lesson by its share of the window, and "now" only inside it', () => {
    const window = { start: 9 * 60, end: 19 * 60 }
    const at10 = place(lesson('a', '10:00', '11:00'), window, ZONE)
    expect(at10.offset).toBeCloseTo(0.1)
    expect(at10.size).toBeCloseTo(0.1)
    expect(nowOffset(window, 14 * 60)).toBeCloseTo(0.5)
    expect(nowOffset(window, 8 * 60)).toBeNull()
  })

  it('names a started lesson without attendance as needing the user, whatever its status but cancelled', () => {
    const now = Date.parse(at('12:00'))
    expect(lessonState(lesson('a', '11:00', '12:30'), now)).toBe('needsAttendance')
    expect(lessonState(lesson('b', '09:00', '10:00', { status: 'completed' }), now)).toBe('needsAttendance')
    expect(lessonState(lesson('c', '11:00', '12:30', { attendanceTakenAt: at('11:05') }), now)).toBe('running')
    expect(lessonState(lesson('d', '09:00', '10:00', { attendanceTakenAt: at('09:05') }), now)).toBe('done')
    expect(lessonState(lesson('e', '15:00', '16:00'), now)).toBe('upcoming')
    expect(lessonState(lesson('f', '09:00', '10:00', { status: 'cancelled' }), now)).toBe('cancelled')
  })

  it('packs overlapping lessons into separate rows and adjacent ones into one', () => {
    const rows = packRows([lesson('a', '09:00', '10:00'), lesson('b', '09:30', '10:30'), lesson('c', '10:00', '11:00')])
    expect(rows.map((row) => row.map((item) => item.id))).toEqual([['a', 'c'], ['b']])
  })

  it('groups by teacher and room, the lessons without one in a last lane', () => {
    const sara = { userId: 't1', fullName: 'Sara' }
    const adam = { userId: 't2', fullName: 'Adam' }
    const r1 = { id: 'r1', code: 'R1', name: null, branch: null }
    const items = [
      lesson('a', '09:00', '10:00', { teacher: sara, room: r1 }),
      lesson('b', '11:00', '12:00', { teacher: adam }),
      lesson('c', '13:00', '14:00'),
    ]
    expect(lanesByTeacher(items).map((lane) => lane.key)).toEqual(['t2', 't1', 'none'])
    expect(lanesByRoom(items).map((lane) => [lane.key, lane.lessons.length])).toEqual([['r1', 1], ['none', 2]])
    expect(busyMinutes([...items, lesson('d', '15:00', '16:00', { status: 'cancelled' })])).toBe(180)
  })
})

describe('the «needs you» list', () => {
  const overview = {
    general: { activeStudents: 1, openClasses: 0, runningClasses: 1, lessonsToday: 1 },
    attendance: null,
    academic: { period: { from: '', to: '' }, finalGrades: 0, averagePercent: null, passRate: null, awaitingReview: 4 },
    financial: { period: { from: '', to: '' }, collected: [], outstanding: [{ currency: 'TRY', balance: 900, overdue: 600, studentsOverdue: 2 }] },
  } as unknown as ReportsOverview
  const bare = { id: 'k', status: 'planned', teachers: [] } as unknown as AcademyClass
  const taught = { id: 'm', status: 'running', teachers: [{ userId: 't' }] } as unknown as AcademyClass
  const done = { id: 'n', status: 'completed', teachers: [] } as unknown as AcademyClass

  it('lists only what the caller could read, with a count above zero', () => {
    const now = Date.parse(at('12:00'))
    const items = attentionItems({ todayLessons: [lesson('a', '11:00', '12:00')], overview, classes: [bare, taught, done], now })
    expect(items.map((item) => [item.kind, item.count])).toEqual([
      ['attendance', 1],
      ['review', 4],
      ['overdue', 2],
      ['noTeacher', 1],
    ])
    expect(attentionItems({ todayLessons: null, overview: null, classes: null, now })).toEqual([])
  })
})

describe('dashboard views and formats', () => {
  it('shows each view only to the holder of the keys behind it', () => {
    const has = (keys: string[]) => (key: string) => keys.includes(key)
    expect(visibleViews(has([]))).toEqual(['today'])
    expect(visibleViews(has(['lessons.read', 'classes.read']))).toEqual(['today', 'week', 'classes'])
    expect(visibleViews(has(['lessons.read', 'classes.read', 'classes.manage', 'reports.financial.view']))).toEqual(['today', 'week', 'classes', 'teachers', 'rooms', 'finance'])
  })

  it('counts months back across a year and formats money without needless decimals', () => {
    expect(monthsBack('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(formatMoney(38400, 'TRY', 'en')).toBe('₺38,400')
    expect(formatMoney(12.5, 'USD', 'en')).toBe('$12.50')
    expect(labelIn({ ar: 'عربي', en: 'English' }, 'en')).toBe('English')
    expect(labelIn({ ar: 'عربي' }, 'en')).toBe('عربي')
  })
})
