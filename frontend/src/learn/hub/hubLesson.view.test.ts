// J-F69: what the lesson popup says about the opened lesson (hubLesson.view.ts).
import { describe, expect, it } from 'vitest'
import type { LessonSession } from '../../api/learning'
import { makeLearningCourse } from '../../mySchool/mySchool.fixtures'
import { makeWorkspace } from '../learn.fixtures'
import { isReachable, lessonFormOf, lessonSessionOf, teacherNameOf, workspaceItemOf } from './hubLesson.view'

function session(id: string, startsAt: string, overrides: Partial<LessonSession> = {}): LessonSession {
  const start = Date.parse(startsAt)
  return {
    id,
    classId: 'k1',
    title: { ar: id },
    startsAt,
    endsAt: new Date(start + 3_600_000).toISOString(),
    status: 'scheduled',
    deliveryMode: 'online',
    meetingUrl: null,
    timeZone: 'UTC',
    attendance: null,
    ...overrides,
  }
}

const NOW = Date.parse('2026-11-24T12:00:00.000Z')

describe('lessonFormOf — «نوع المحاضرة»', () => {
  it('names a live lesson, a recorded lecture (video, audio) and any other kind by itself', () => {
    expect(lessonFormOf('live')).toBe('live')
    expect(lessonFormOf('video')).toBe('recorded')
    expect(lessonFormOf('audio')).toBe('recorded')
    expect(lessonFormOf('text')).toBe('text')
    expect(lessonFormOf('pdf')).toBe('pdf')
    expect(lessonFormOf('image')).toBe('image')
    expect(lessonFormOf('file')).toBe('file')
  })
})

describe('lessonSessionOf — «الموعد»', () => {
  it('is none without a session', () => {
    expect(lessonSessionOf([], NOW)).toBeNull()
  })

  it('names the earliest session that has not ended, whatever the order of the list', () => {
    const later = session('later', '2026-12-01T10:00:00.000Z')
    const sooner = session('sooner', '2026-11-26T10:00:00.000Z')
    const running = session('running', '2026-11-24T11:30:00.000Z')
    expect(lessonSessionOf([later, sooner], NOW)?.id).toBe('sooner')
    expect(lessonSessionOf([later, running, sooner], NOW)?.id).toBe('running')
  })

  it('names the latest held session once none is left, and never a cancelled one', () => {
    const first = session('first', '2026-11-01T10:00:00.000Z')
    const second = session('second', '2026-11-10T10:00:00.000Z')
    const cancelled = session('cancelled', '2026-11-30T10:00:00.000Z', { status: 'cancelled' })
    expect(lessonSessionOf([second, first, cancelled], NOW)?.id).toBe('second')
    expect(lessonSessionOf([cancelled], NOW)).toBeNull()
  })
})

describe('teacherNameOf — «المعلم»', () => {
  it('prefers the name the teacher shows, then their full name; none without a lead teacher', () => {
    expect(teacherNameOf(makeLearningCourse())).toBe('خالد المعلم')
    expect(teacherNameOf(makeLearningCourse({ leadTeacher: { fullName: 'خالد المعلم', displayName: ' أ. خالد ' } }))).toBe('أ. خالد')
    expect(teacherNameOf(makeLearningCourse({ leadTeacher: null }))).toBeNull()
  })
})

describe('workspaceItemOf and isReachable', () => {
  it('finds the lesson’s row in any level of the workspace, or nothing', () => {
    const workspace = makeWorkspace()
    expect(workspaceItemOf(workspace, 'i3')?.kind).toBe('pdf')
    expect(workspaceItemOf(workspace, 'missing')).toBeNull()
    expect(workspaceItemOf(null, 'i1')).toBeNull()
  })

  it('steps toward a lesson that can be opened only', () => {
    expect(isReachable(null)).toBe(false)
    expect(isReachable({ id: 'i2', title: { ar: 'x' }, available: true })).toBe(true)
    expect(isReachable({ id: 'i3', title: { ar: 'x' }, available: false })).toBe(false)
  })
})
