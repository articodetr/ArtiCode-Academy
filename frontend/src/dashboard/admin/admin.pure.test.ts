import { describe, expect, it } from 'vitest'
import { makeLesson } from '../../test/lessons'
import { makeUser } from '../../test/render'
import { PHONE_VISIBLE_ACTIONS, QUICK_ACTION_KEYS, quickActionsFor } from './admin.actions'
import { formatCount, formatDayHeading, formatRate } from './admin.format'
import { ACTION_COLUMNS, STAT_COLUMNS, balancedColumns, columnsStyle } from './admin.layout'
import { WEEK_LESSONS_SHOWN, byDay, lessonsToShow } from './admin.lessons'

/** Every key the eleven actions need (the academy_admin seed holds them all). */
const FULL_ADMIN = [
  'users.read',
  'users.create',
  'courses.read',
  'courses.manage',
  'classes.read',
  'classes.manage',
  'classes.teachers.assign',
  'lessons.read',
  'schedule.read',
  'enrollments.manage',
  'assignments.read',
  'exams.read',
  'invoices.read_all',
  'certificates.read_all',
]

function actionsOf(permissions: string[], roles: string[] = ['academy_admin']) {
  const user = makeUser({ permissions, roles })
  return quickActionsFor(user, (key) => permissions.includes(key))
}

describe('quickActionsFor — the admin home’s quick actions (J-F59)', () => {
  it('gives a full admin the eleven actions in the spec’s order, each to an existing page — none to /classes', () => {
    const actions = actionsOf(FULL_ADMIN)
    expect(actions.map((action) => action.key)).toEqual([...QUICK_ACTION_KEYS])
    expect(Object.fromEntries(actions.map((action) => [action.key, action.to]))).toEqual({
      addStudent: '/users?create=student',
      addTeacher: '/users?create=teacher',
      createCourse: '/courses?create=course',
      assignTeacher: '/courses',
      lessons: '/lessons',
      schedule: '/schedule',
      enrollmentRequests: '/enrollment-requests',
      assignments: '/assignments',
      exams: '/exams',
      payments: '/payments',
      certificates: '/certificates',
    })
    expect(actions).toHaveLength(11)
    expect(QUICK_ACTION_KEYS).not.toContain('classes')
    expect(actions.some((action) => action.to.startsWith('/classes'))).toBe(false)
  })

  it('opens «assign a teacher» on /courses (the course drawer’s teachers) — with courses.read, classes.teachers.assign and classes.read', () => {
    const keys = (permissions: string[], roles?: string[]) => actionsOf(permissions, roles).map((action) => action.key)
    expect(keys(['courses.read', 'classes.read', 'classes.teachers.assign'])).toEqual(['assignTeacher'])
    expect(actionsOf(['courses.read', 'classes.read', 'classes.teachers.assign'])[0]!.to).toBe('/courses')
    // Each of the three keys is needed: the page, the write of a class’s teachers, the read of the course’s classes.
    expect(keys(['classes.read', 'classes.teachers.assign'])).toEqual([])
    expect(keys(['courses.read', 'classes.teachers.assign'])).toEqual([])
    expect(keys(['courses.read', 'classes.read'])).toEqual([])
    // A learner-only viewer never gets the courses page (canAccess), whatever the keys.
    expect(keys(['courses.read', 'classes.read', 'classes.teachers.assign'], ['student'])).toEqual([])
  })

  it('shows no «add» card to a viewer who may only read: no users.create, no courses.manage, no classes.teachers.assign', () => {
    const keys = actionsOf(['users.read', 'courses.read', 'classes.read', 'lessons.read']).map((action) => action.key)
    expect(keys).toEqual(['lessons'])
  })

  it('needs the page’s own read key too: users.create without users.read opens no /users card', () => {
    expect(actionsOf(['users.create', 'courses.manage']).map((action) => action.key)).toEqual([])
  })

  it('opens /payments only in its office view — a learner key (invoices.read_own) is no admin action', () => {
    expect(actionsOf(['invoices.read_own'], ['staff']).map((action) => action.key)).toEqual([])
    expect(actionsOf(['payments.record'], ['staff']).map((action) => action.key)).toEqual(['payments'])
  })
})

describe('admin.layout — rows balanced so none ends on a gap (2026-11-26)', () => {
  it('spreads the cards evenly over as few rows as the width allows', () => {
    // Eleven actions (a full admin): 6 + 5, 4 + 4 + 3, 3 + 3 + 3 + 2, two per row.
    expect(ACTION_COLUMNS.map((max) => balancedColumns(11, max))).toEqual([2, 3, 4, 6])
    // Seven: 4 + 3 rather than 6 + 1; eight: 4 + 4 rather than 6 + 2.
    expect(balancedColumns(7, 6)).toBe(4)
    expect(balancedColumns(8, 6)).toBe(4)
    // Fewer cards than a row holds share that one row.
    expect(balancedColumns(3, 6)).toBe(3)
    expect(balancedColumns(1, 2)).toBe(1)
    // Five figures (every key): one row of 5, then 3 + 2, then two per row.
    expect(STAT_COLUMNS.map((max) => balancedColumns(5, max))).toEqual([2, 3, 3, 5])
  })

  it('hands admin.css one custom property per column count', () => {
    expect(columnsStyle('admin-stats-cols', 4, STAT_COLUMNS)).toEqual({ '--admin-stats-cols-2': '2', '--admin-stats-cols-3': '2', '--admin-stats-cols-4': '4', '--admin-stats-cols-5': '4' })
  })

  it('keeps three full rows of two on a phone before «show more»', () => {
    expect(PHONE_VISIBLE_ACTIONS % balancedColumns(11, 2)).toBe(0)
  })
})

describe('admin.lessons — what the schedule card lists (J-F59)', () => {
  const at = (iso: string) => Date.parse(iso)
  const early = makeLesson({ id: 'a', startsAt: '2026-11-22T08:00:00.000Z', endsAt: '2026-11-22T09:00:00.000Z' })
  const late = makeLesson({ id: 'b', startsAt: '2026-11-22T15:00:00.000Z', endsAt: '2026-11-22T16:00:00.000Z' })
  const tomorrow = makeLesson({ id: 'c', startsAt: '2026-11-23T08:00:00.000Z', endsAt: '2026-11-23T09:00:00.000Z' })

  it('lists every lesson of today in start order, the ended ones too', () => {
    expect(lessonsToShow([late, early], 'day', at('2026-11-22T12:00:00Z')).map((lesson) => lesson.id)).toEqual(['a', 'b'])
  })

  it('lists only the lessons of the week that have not ended, at most WEEK_LESSONS_SHOWN', () => {
    expect(lessonsToShow([tomorrow, late, early], 'week', at('2026-11-22T12:00:00Z')).map((lesson) => lesson.id)).toEqual(['b', 'c'])
    const many = Array.from({ length: WEEK_LESSONS_SHOWN + 3 }, (_, index) =>
      makeLesson({ id: `m${index}`, startsAt: `2026-11-24T${String(index).padStart(2, '0')}:00:00.000Z`, endsAt: `2026-11-24T${String(index).padStart(2, '0')}:30:00.000Z` }),
    )
    expect(lessonsToShow(many, 'week', at('2026-11-22T12:00:00Z'))).toHaveLength(WEEK_LESSONS_SHOWN)
  })

  it('groups lessons by their day in the academy’s zone, not in UTC', () => {
    // 22:30 UTC on the 22nd is already the 23rd in Istanbul (UTC+3).
    const night = makeLesson({ id: 'n', startsAt: '2026-11-22T22:30:00.000Z', endsAt: '2026-11-22T23:00:00.000Z' })
    expect(byDay([early, night, tomorrow], 'Europe/Istanbul').map((group) => [group.date, group.lessons.map((lesson) => lesson.id)])).toEqual([
      ['2026-11-22', ['a']],
      ['2026-11-23', ['n', 'c']],
    ])
  })
})

describe('admin.format (J-F59)', () => {
  it('writes counts and rates with Latin digits in Arabic too', () => {
    expect(formatCount(1234, 'ar')).toMatch(/^1[,٬]234$/)
    expect(formatRate(87.5, 'en')).toBe('87.5%')
    expect(formatRate(90, 'ar')).toMatch(/90/)
  })

  it('names a calendar day as it is, whatever the device’s zone', () => {
    expect(formatDayHeading('2026-11-22', 'en', true)).toBe('Sunday, November 22, 2026')
    expect(formatDayHeading('2026-11-22', 'en')).toBe('Sunday, November 22')
  })
})
