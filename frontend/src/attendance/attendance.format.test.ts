import { describe, expect, it } from 'vitest'
import { ATTENDANCE_STATUSES } from '../api/attendance'
import { ATTENDANCE_STATUS_COLORS } from './attendance.format'

describe('ATTENDANCE_STATUS_COLORS', () => {
  it('gives each of the four statuses its own colour and nothing else', () => {
    expect(Object.keys(ATTENDANCE_STATUS_COLORS).sort()).toEqual([...ATTENDANCE_STATUSES].sort())
    expect(new Set(Object.values(ATTENDANCE_STATUS_COLORS)).size).toBe(ATTENDANCE_STATUSES.length)
    expect(ATTENDANCE_STATUS_COLORS).toEqual({ present: 'green', absent: 'red', late: 'gold', excused: 'blue' })
  })
})
