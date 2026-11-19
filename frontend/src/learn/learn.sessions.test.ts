// TEST-263 (LRN-T06) — the pure rules of the class sessions (D-R143) and of a
// level that opens on a date (D-R145): what is ahead and what is behind, how
// the learner's own attendance reads, and that the course player never opens
// a lesson the server lists as not available.
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { levelNotOpenOf } from './learn.errors'
import { makeSession, makeWorkspace, withSecondLevelClosed } from './learn.fixtures'
import { attendanceTextOf, isSessionLive, splitSessions } from './learn.sessions'
import { everyLessonLocked, firstOpeningDayOf, isItemAvailable, openingItemOf } from './learn.state'

const NOW = Date.parse('2026-11-19T12:00:00.000Z')
const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)

describe('splitSessions / isSessionLive', () => {
  it('puts the sessions not ended yet ahead (soonest first) and the others behind (most recent first)', () => {
    const sessions = [
      makeSession({ id: 'old', startsAt: '2026-10-01T10:00:00.000Z', endsAt: '2026-10-01T11:00:00.000Z' }),
      makeSession({ id: 'later', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T11:00:00.000Z' }),
      makeSession({ id: 'live', startsAt: '2026-11-19T11:30:00.000Z', endsAt: '2026-11-19T12:30:00.000Z' }),
      makeSession({ id: 'recent', startsAt: '2026-11-18T10:00:00.000Z', endsAt: '2026-11-18T11:00:00.000Z' }),
    ]
    const { upcoming, past } = splitSessions(sessions, NOW)
    expect(upcoming.map((session) => session.id)).toEqual(['live', 'later'])
    expect(past.map((session) => session.id)).toEqual(['recent', 'old'])
    expect(isSessionLive(sessions[2]!, NOW)).toBe(true)
    expect(isSessionLive(sessions[1]!, NOW)).toBe(false)
  })
})

describe('attendanceTextOf', () => {
  const past = { startsAt: '2026-11-18T10:00:00.000Z', endsAt: '2026-11-18T11:00:00.000Z' }
  it('names a recorded status, the lateness in minutes, and «not recorded» only once the session started', () => {
    expect(attendanceTextOf({ ...past, status: 'completed', attendance: { status: 'present', minutesLate: null } }, t, NOW)).toBe('learn.live.attendance.present')
    expect(attendanceTextOf({ ...past, status: 'completed', attendance: { status: 'late', minutesLate: 7 } }, t, NOW)).toBe('learn.live.lateBy {"minutes":7}')
    expect(attendanceTextOf({ ...past, status: 'completed', attendance: null }, t, NOW)).toBe('learn.live.noAttendance')
    expect(attendanceTextOf({ startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T11:00:00.000Z', status: 'scheduled', attendance: null }, t, NOW)).toBeNull()
    expect(attendanceTextOf({ ...past, status: 'cancelled', attendance: null }, t, NOW)).toBeNull()
    expect(attendanceTextOf({ ...past, status: 'completed', attendance: { status: 'unknown', minutesLate: null } }, t, NOW)).toBe('learn.live.noAttendance')
  })
})

describe('a level that opens on a date (D-R145)', () => {
  it('never opens a lesson listed as not available, even as the resume target', () => {
    const workspace = withSecondLevelClosed(makeWorkspace({ resume: { itemId: 'i3', reason: 'last', positionSeconds: null } }))
    expect(openingItemOf(workspace)).toBe('i1')
    expect(openingItemOf(workspace, new Set(['i1']))).toBe('i2')
    expect(openingItemOf(workspace, new Set(['i1', 'i2']))).toBeNull()
  })

  it('reads a body without the fields as open (a server before LRN-T06)', () => {
    const { available: _unused, ...older } = makeWorkspace().sections[0]!.items[0]!
    expect(isItemAvailable(older as unknown as { available: boolean })).toBe(true)
    expect(isItemAvailable({ available: false })).toBe(false)
  })

  it('finds the earliest opening day when every lesson is locked', () => {
    const closed = withSecondLevelClosed(makeWorkspace(), '2030-02-01')
    expect(everyLessonLocked(closed)).toBe(false)
    expect(firstOpeningDayOf(closed)).toBe('2030-02-01')
    const all = { ...closed, sections: closed.sections.map((section) => ({ ...section, isOpen: false, opensOn: section.opensOn ?? '2030-01-15', items: section.items.map((item) => ({ ...item, available: false })) })) }
    expect(everyLessonLocked(all)).toBe(true)
    expect(firstOpeningDayOf(all)).toBe('2030-01-15')
  })

  it('reads 403 level_not_open with its day, and nothing else', () => {
    const refusal = (body: Record<string, unknown>) => new ApiError(403, 'This level is not open yet', body)
    expect(levelNotOpenOf(refusal({ code: 'level_not_open', itemId: 'i3', opensOn: '2030-02-01' }))).toEqual({ opensOn: '2030-02-01' })
    expect(levelNotOpenOf(refusal({ code: 'level_not_open', itemId: 'i3', opensOn: '<b>soon</b>' }))).toEqual({ opensOn: null })
    expect(levelNotOpenOf(new ApiError(403, 'No enrollment', { code: 'not_enrolled' }))).toBeNull()
    expect(levelNotOpenOf(new Error('network'))).toBeNull()
  })
})
