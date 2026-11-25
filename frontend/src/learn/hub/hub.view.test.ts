import { describe, expect, it } from 'vitest'
import { makeChildCourse, makeCompletedCourse, makeLearningCourse, makeProgress } from '../../mySchool/mySchool.fixtures'
import { makeWorkspace } from '../learn.fixtures'
import { chosenCourseOf, countsOf, hubGroupsOf, mergedLessonsOf, hubTotals, isStudyCourse, matchesFilter, rowActionOf, studyCourses } from './hub.view'

describe('hub.view (J-F64)', () => {
  it('lists the learner’s own courses once each, the unfinished ones first — never a child’s', () => {
    const active = makeLearningCourse()
    const twin = makeLearningCourse({ enrollmentId: 'other', lastActivityAt: '2026-01-01T00:00:00.000Z' })
    const done = makeCompletedCourse({ lastActivityAt: '2026-11-22T00:00:00.000Z' })
    const child = makeChildCourse()
    expect(studyCourses([done, twin, child, active]).map((item) => item.enrollmentId)).toEqual([active.enrollmentId, done.enrollmentId])
  })

  it('sums the server’s counts, preferring this page’s latest answer', () => {
    const first = makeLearningCourse()
    const second = makeCompletedCourse()
    const live = { [first.course.id]: makeProgress({ total: 9, completed: 4 }) }
    expect(countsOf(first, live).completed).toBe(4)
    expect(hubTotals([first, second], live)).toEqual({ courses: 2, lessons: 15, completed: 10 })
  })

  it('shows a course only once the address names one the learner studies (J-F67)', () => {
    const first = makeLearningCourse()
    const second = makeCompletedCourse()
    expect(chosenCourseOf([first, second], second.course.id)).toBe(second)
    expect(chosenCourseOf([first, second], 'unknown')).toBeNull()
    expect(chosenCourseOf([first, second], null)).toBeNull()
  })

  it('merges every course’s lessons newest first, ties by course then curriculum (J-F67)', () => {
    const first = makeLearningCourse()
    const second = makeCompletedCourse()
    const rows = mergedLessonsOf([{ course: first, workspace: makeWorkspace() }, { course: second, workspace: makeWorkspace() }], 'all')
    expect(rows.map((row) => [row.course.course.id, row.item.id])).toEqual([
      [first.course.id, 'i4'], [second.course.id, 'i4'], [first.course.id, 'i3'], [second.course.id, 'i3'],
      [first.course.id, 'i2'], [second.course.id, 'i2'], [first.course.id, 'i1'], [second.course.id, 'i1'],
    ].filter(([, id]) => rows.some((row) => row.item.id === id)))
  })

  it('lets a card of «فصولي» show the lessons of the learner’s own courses only (J-F67)', () => {
    expect(isStudyCourse(makeLearningCourse())).toBe(true)
    expect(isStudyCourse(makeChildCourse())).toBe(false)
    expect(isStudyCourse(makeLearningCourse({ canLearn: false }))).toBe(false)
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
