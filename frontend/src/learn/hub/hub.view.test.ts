import { describe, expect, it } from 'vitest'
import { makeChildCourse, makeCompletedCourse, makeLearningCourse, makeProgress } from '../../mySchool/mySchool.fixtures'
import { makeWorkspace } from '../learn.fixtures'
import { cardPercent, countsOf, hubGroupsOf, hubTotals, matchesFilter, rowActionOf, selectedCourseOf, studyCourses } from './hub.view'

describe('hub.view (J-F64)', () => {
  it('lists the learner’s own courses once each, the unfinished ones first — never a child’s', () => {
    const active = makeLearningCourse()
    const twin = makeLearningCourse({ enrollmentId: 'other', lastActivityAt: '2026-01-01T00:00:00.000Z' })
    const done = makeCompletedCourse({ lastActivityAt: '2026-11-22T00:00:00.000Z' })
    const child = makeChildCourse()
    expect(studyCourses([done, twin, child, active]).map((item) => item.enrollmentId)).toEqual([active.enrollmentId, done.enrollmentId])
  })

  it('opens the course the address names, else the first', () => {
    const first = makeLearningCourse()
    const second = makeCompletedCourse()
    expect(selectedCourseOf([first, second], second.course.id)).toBe(second)
    expect(selectedCourseOf([first, second], 'unknown')).toBe(first)
    expect(selectedCourseOf([], null)).toBeNull()
  })

  it('sums the server’s counts, preferring this page’s latest answer', () => {
    const first = makeLearningCourse()
    const second = makeCompletedCourse()
    const live = { [first.course.id]: makeProgress({ total: 9, completed: 4 }) }
    expect(countsOf(first, live).completed).toBe(4)
    expect(hubTotals([first, second], live)).toEqual({ courses: 2, lessons: 15, completed: 10 })
    expect(cardPercent(makeProgress({ percent: null }))).toBe(0)
  })

  it('filters live and recorded lessons', () => {
    expect(matchesFilter({ kind: 'live' }, 'live')).toBe(true)
    expect(matchesFilter({ kind: 'video' }, 'live')).toBe(false)
    expect(matchesFilter({ kind: 'pdf' }, 'recorded')).toBe(true)
    expect(matchesFilter({ kind: 'live' }, 'recorded')).toBe(false)
    expect(matchesFilter({ kind: 'live' }, 'all')).toBe(true)
  })

  it('numbers the lessons across the course and keeps the numbers through a filter', () => {
    const workspace = makeWorkspace()
    expect(hubGroupsOf(workspace, 'all').flatMap((group) => group.rows.map((row) => row.number))).toEqual([1, 2, 3, 4])
    const [section] = workspace.sections
    const withLive = {
      ...workspace,
      sections: [workspace.sections[0]!, { ...workspace.sections[1]!, items: [{ ...workspace.sections[1]!.items[0]!, kind: 'live' as const }] }],
    }
    const live = hubGroupsOf(withLive, 'live')
    expect(live).toHaveLength(1)
    expect(live[0]!.section.id).not.toBe(section!.id)
    expect(live[0]!.rows[0]!.number).toBe(3)
  })

  it('names what a row offers', () => {
    expect(rowActionOf({ kind: 'video' })).toBe('play')
    expect(rowActionOf({ kind: 'audio' })).toBe('play')
    expect(rowActionOf({ kind: 'live' })).toBe('attend')
    expect(rowActionOf({ kind: 'pdf' })).toBe('open')
  })
})
