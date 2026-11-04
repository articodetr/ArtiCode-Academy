import { describe, expect, it } from 'vitest'
import { CLASS_STATUSES } from '../api/classes'
import { availableClassActions, isDangerousClassAction, movesEnrollments, nextClassStatus } from './classes.status'

describe('classes.status (mirror of backend/src/classes/classes.status.ts)', () => {
  it('follows the documented transitions', () => {
    expect(nextClassStatus('open', 'planned')).toBe('open')
    expect(nextClassStatus('start', 'open')).toBe('running')
    expect(nextClassStatus('complete', 'running')).toBe('completed')
    expect(nextClassStatus('cancel', 'planned')).toBe('cancelled')
    expect(nextClassStatus('cancel', 'running')).toBe('cancelled')
    expect(nextClassStatus('restore', 'cancelled')).toBe('planned')
    expect(nextClassStatus('start', 'planned')).toBeNull()
    expect(nextClassStatus('cancel', 'completed')).toBeNull()
  })

  it('offers the allowed actions per status, delete only for a planned class without active enrollments', () => {
    const offered = Object.fromEntries(CLASS_STATUSES.map((status) => [status, availableClassActions(status, 0, true)]))
    expect(offered).toEqual({
      planned: ['open', 'cancel', 'delete'],
      open: ['start', 'cancel'],
      running: ['complete', 'cancel'],
      completed: [],
      cancelled: ['restore'],
    })
    expect(availableClassActions('planned', 2, true)).toEqual(['open', 'cancel'])
  })

  it('offers nothing without classes.manage', () => {
    for (const status of CLASS_STATUSES) expect(availableClassActions(status, 0, false)).toEqual([])
  })

  it('marks cancel and delete as dangerous, and complete/cancel as moving the enrollments', () => {
    expect(['open', 'start', 'complete', 'cancel', 'restore', 'delete'].filter((action) => isDangerousClassAction(action as never))).toEqual(['cancel', 'delete'])
    expect(['open', 'start', 'complete', 'cancel', 'restore', 'delete'].filter((action) => movesEnrollments(action as never))).toEqual(['complete', 'cancel'])
  })
})
