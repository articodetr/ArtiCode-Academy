import { describe, expect, it } from 'vitest'
import { LESSON_STATUSES } from '../api/lessons'
import type { LessonStatus } from '../api/lessons'
import { makeLesson } from '../test/lessons'
import { availableLessonActions, hasLessonStarted, isDangerousLessonAction, isLessonDeletable, lessonEditability, lockedLessonFields, nextLessonStatus } from './lessons.status'

const NOW = new Date('2026-11-10T12:00:00.000Z')
const past = makeLesson() // starts 2026-11-10T10:00Z — before NOW
const future = makeLesson({ startsAt: '2026-11-11T10:00:00.000Z', endsAt: '2026-11-11T11:00:00.000Z' })

describe('lessons.status (mirror of backend/src/lessons/lessons.status.ts)', () => {
  it('follows the documented transitions', () => {
    expect(nextLessonStatus('complete', 'scheduled')).toBe('completed')
    expect(nextLessonStatus('cancel', 'scheduled')).toBe('cancelled')
    expect(nextLessonStatus('restore', 'cancelled')).toBe('scheduled')
    expect(nextLessonStatus('restore', 'scheduled')).toBeNull()
    expect(nextLessonStatus('cancel', 'completed')).toBeNull()
    expect(nextLessonStatus('complete', 'in_progress')).toBeNull()
  })

  it('offers complete only once the lesson has started, delete only for a scheduled lesson without attendance, restore for a cancelled one', () => {
    expect(availableLessonActions(past, true, NOW)).toEqual(['complete', 'cancel', 'delete'])
    expect(availableLessonActions(future, true, NOW)).toEqual(['cancel', 'delete'])
    expect(availableLessonActions({ ...past, attendance: { recorded: 3, present: 3, absent: 0, late: 0, excused: 0 } }, true, NOW)).toEqual(['complete', 'cancel'])
    const offered = Object.fromEntries(LESSON_STATUSES.map((status) => [status, availableLessonActions({ ...past, status }, true, NOW)]))
    expect(offered).toEqual({ scheduled: ['complete', 'cancel', 'delete'], in_progress: [], completed: [], cancelled: ['restore'] })
    expect(hasLessonStarted(past.startsAt, NOW)).toBe(true)
    expect(hasLessonStarted(future.startsAt, NOW)).toBe(false)
    expect(hasLessonStarted('not-a-date', NOW)).toBe(false)
    expect(isLessonDeletable('scheduled', 0)).toBe(true)
    expect(isLessonDeletable('scheduled', 1)).toBe(false)
    expect(isLessonDeletable('cancelled', 0)).toBe(false)
  })

  it('offers nothing without lessons.manage or for a lesson of a completed or cancelled class', () => {
    for (const status of LESSON_STATUSES) expect(availableLessonActions({ ...past, status }, false, NOW)).toEqual([])
    expect(availableLessonActions({ ...past, class: { ...past.class, status: 'completed' } }, true, NOW)).toEqual([])
    expect(availableLessonActions({ ...past, class: { ...past.class, status: 'cancelled' } }, true, NOW)).toEqual([])
  })

  it('locks the timing fields of a completed lesson, everything of a cancelled one, nothing of a scheduled one', () => {
    const requested = ['title', 'startsAt', 'roomId', 'meetingUrl', 'teacherUserId', 'endsAt']
    expect(lockedLessonFields('scheduled', requested)).toEqual([])
    expect(lockedLessonFields('completed', requested)).toEqual(['startsAt', 'roomId', 'teacherUserId', 'endsAt'])
    expect(lockedLessonFields('in_progress', requested)).toEqual(['startsAt', 'roomId', 'teacherUserId', 'endsAt'])
    expect(lockedLessonFields('cancelled', requested)).toEqual(requested)
    const editability = (status: LessonStatus, canManage = true) => lessonEditability({ ...past, status }, canManage)
    expect(editability('scheduled')).toEqual({ editable: true, timingLocked: false })
    expect(editability('completed')).toEqual({ editable: true, timingLocked: true })
    expect(editability('cancelled')).toEqual({ editable: false, timingLocked: true })
    expect(editability('scheduled', false)).toEqual({ editable: false, timingLocked: true })
    expect(lessonEditability({ ...past, class: { ...past.class, status: 'completed' } }, true)).toEqual({ editable: false, timingLocked: true })
  })

  it('marks cancel and delete as dangerous', () => {
    expect(['complete', 'cancel', 'restore', 'delete'].filter((action) => isDangerousLessonAction(action as never))).toEqual(['cancel', 'delete'])
  })
})
