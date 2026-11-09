import { describe, expect, it } from 'vitest'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { academyZoneOf, dayEndIn, dayStartIn, differsFromDevice, dueZoneOf, instantIn, lessonZoneOf, wallClockIn } from './assignments.zone'

const HOUR = 3_600_000

describe('assignments.zone — the zone a due date is typed in (D-R41)', () => {
  it('reads the academy zone and a lesson zone defensively', () => {
    expect(academyZoneOf({ timezone: 'Asia/Riyadh' })).toBe('Asia/Riyadh')
    expect(academyZoneOf({ timezone: 'Mars/Olympus' })).toBeNull()
    expect(academyZoneOf({})).toBeNull()
    expect(academyZoneOf(null)).toBeNull()
    expect(lessonZoneOf({ id: 'l-1', timeZone: 'Europe/Istanbul' })).toBe('Europe/Istanbul')
    expect(lessonZoneOf({ id: 'l-1' })).toBeNull()
    expect(lessonZoneOf(undefined)).toBeNull()
  })

  it('creates in the chosen lesson zone, else the academy zone, else this device zone', () => {
    const device = 'America/Chicago'
    expect(dueZoneOf({ lessonId: 'l-1', lessonZone: 'Europe/Istanbul', academyZone: 'Asia/Riyadh', deviceZone: device })).toEqual({ zone: 'Europe/Istanbul', source: 'lesson' })
    expect(dueZoneOf({ lessonId: undefined, lessonZone: null, academyZone: 'Asia/Riyadh', deviceZone: device })).toEqual({ zone: 'Asia/Riyadh', source: 'academy' })
    // A lesson whose zone the list does not carry: the academy zone (its room's branch may differ — the hint names the zone used).
    expect(dueZoneOf({ lessonId: 'l-1', lessonZone: null, academyZone: 'Asia/Riyadh', deviceZone: device })).toEqual({ zone: 'Asia/Riyadh', source: 'academy' })
    expect(dueZoneOf({ lessonId: undefined, lessonZone: null, academyZone: null, deviceZone: device })).toEqual({ zone: device, source: 'device' })
  })

  it('edits in the assignment zone while the lesson link stays, in the new lesson zone or the academy zone once it changes', () => {
    const current = { lessonId: 'l-1', timeZone: 'Europe/Istanbul' }
    const base = { academyZone: 'Asia/Riyadh', deviceZone: 'UTC', current }
    expect(dueZoneOf({ ...base, lessonId: 'l-1', lessonZone: 'Europe/Istanbul' })).toEqual({ zone: 'Europe/Istanbul', source: 'assignment' })
    // The server's zone wins over the list's for the lesson already linked.
    expect(dueZoneOf({ ...base, lessonId: 'l-1', lessonZone: 'Asia/Dubai' })).toEqual({ zone: 'Europe/Istanbul', source: 'assignment' })
    expect(dueZoneOf({ ...base, lessonId: 'l-2', lessonZone: 'Asia/Dubai' })).toEqual({ zone: 'Asia/Dubai', source: 'lesson' })
    expect(dueZoneOf({ ...base, lessonId: undefined, lessonZone: null })).toEqual({ zone: 'Asia/Riyadh', source: 'academy' })
    // An assignment without a lesson that stays without one keeps its own zone.
    expect(dueZoneOf({ ...base, current: { lessonId: null, timeZone: 'Asia/Riyadh' }, lessonId: '', lessonZone: null })).toEqual({ zone: 'Asia/Riyadh', source: 'assignment' })
  })

  it('turns an instant into the wall clock of a zone and back', () => {
    const due = '2026-11-20T20:59:00.000Z'
    expect(wallClockIn(due, 'Asia/Riyadh')).toEqual({ date: '2026-11-20', time: '23:59' })
    expect(wallClockIn(due, 'America/New_York')).toEqual({ date: '2026-11-20', time: '15:59' })
    expect(wallClockIn(due, 'Pacific/Kiritimati')).toEqual({ date: '2026-11-21', time: '10:59' })
    expect(wallClockIn('not a date', 'Asia/Riyadh')).toEqual({ date: '', time: '' })
    expect(instantIn('2026-11-20', '23:59', 'Asia/Riyadh')).toBe(due)
    expect(instantIn('2026-11-21', '10:59', 'Pacific/Kiritimati')).toBe(due)
    expect(instantIn('2026-11-20', '', 'Asia/Riyadh')).toBeUndefined()
    expect(instantIn('2026-02-30', '10:00', 'Asia/Riyadh')).toBeUndefined()
    expect(instantIn('2026-11-20', '24:00', 'Asia/Riyadh')).toBeUndefined()
  })

  it('stays on the typed wall clock across a DST change: a repeated time takes its first occurrence, a skipped time lands next to the gap', () => {
    // 2026-11-01 01:30 happens twice in New York (EDT, then EST): the first one is 05:30Z.
    expect(instantIn('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
    // 2026-03-08 02:30 does not exist in New York: an instant an hour away from it, never another day.
    const skipped = instantIn('2026-03-08', '02:30', 'America/New_York')!
    expect(['01:30', '03:30']).toContain(wallClockIn(skipped, 'America/New_York').time)
    expect(wallClockIn(skipped, 'America/New_York').date).toBe('2026-03-08')
  })

  it('reads the due-date filter days in a zone, a 25-hour day included', () => {
    expect(dayStartIn('2026-11-20', 'Asia/Riyadh')).toBe('2026-11-19T21:00:00.000Z')
    expect(dayEndIn('2026-11-20', 'Asia/Riyadh')).toBe('2026-11-20T20:59:59.999Z')
    const start = Date.parse(dayStartIn('2026-11-01', 'America/New_York')!)
    const end = Date.parse(dayEndIn('2026-11-01', 'America/New_York')!)
    expect(end - start).toBe(25 * HOUR - 1)
    expect(dayStartIn(undefined, 'Asia/Riyadh')).toBeUndefined()
    expect(dayEndIn('2026-13-01', 'Asia/Riyadh')).toBeUndefined()
  })

  it('names a zone only when it is not this device zone', () => {
    expect(differsFromDevice('Asia/Riyadh', 'Asia/Riyadh')).toBe(false)
    expect(differsFromDevice('Asia/Riyadh', 'UTC')).toBe(true)
    expect(differsFromDevice(deviceTimeZone())).toBe(false)
  })
})
