import { describe, expect, it } from 'vitest'
import * as assignmentsZone from '../assignments/assignments.zone'
import * as lessonsFormat from '../lessons/lessons.format'
import { FAR_TIME_ZONE } from '../test/lessons'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { academyTimeZoneOf, dayEndIn, dayStartIn, differsFromDevice, instantIn, sameTimeZone, wallClockIn } from './timeZone'

const BERLIN = 'Europe/Berlin'
const NEW_YORK = 'America/New_York'
const HOUR = 3_600_000

describe('common/timeZone (J-F48)', () => {
  it('reads the academy’s zone from GET /api/academy, or null when it is missing or unknown', () => {
    expect(academyTimeZoneOf({ timezone: 'Asia/Riyadh' })).toBe('Asia/Riyadh')
    expect(academyTimeZoneOf({ timezone: 'Mars/Olympus' })).toBeNull()
    expect(academyTimeZoneOf({ timezone: 42 })).toBeNull()
    expect(academyTimeZoneOf({})).toBeNull()
    expect(academyTimeZoneOf(null)).toBeNull()
    expect(academyTimeZoneOf(undefined)).toBeNull()
  })

  it('compares zones once for every screen: an alias is the zone it stands for, the same offset is not the same zone', () => {
    expect(sameTimeZone('UTC', 'Etc/UTC')).toBe(true)
    expect(sameTimeZone('Asia/Kolkata', 'Asia/Calcutta')).toBe(true)
    expect(sameTimeZone('Asia/Riyadh', 'Europe/Istanbul')).toBe(false)
    expect(sameTimeZone('Mars/Base', 'Mars/Base')).toBe(true)
    // The assignments' copy compared names literally (`Etc/UTC` ≠ `UTC`): one rule now.
    expect(differsFromDevice('Etc/UTC', 'UTC')).toBe(false)
    expect(differsFromDevice(BERLIN, 'UTC')).toBe(true)
    expect(differsFromDevice(deviceTimeZone())).toBe(false)
    expect(differsFromDevice(FAR_TIME_ZONE)).toBe(true)
  })

  it('converts the native inputs’ wall clock of a zone to instants and back, DST-safe as the server', () => {
    expect(wallClockIn('2026-11-20T09:00:00.000Z', BERLIN)).toEqual({ date: '2026-11-20', time: '10:00' })
    expect(wallClockIn('2026-11-10T10:00:00.000Z', FAR_TIME_ZONE)).toEqual({ date: '2026-11-11', time: '00:00' })
    expect(wallClockIn('garbage', BERLIN)).toEqual({ date: '', time: '' })
    expect(instantIn('2026-11-20', '10:00', BERLIN)).toBe('2026-11-20T09:00:00.000Z')
    expect(instantIn('2026-11-20', '24:00', BERLIN)).toBeUndefined()
    expect(instantIn('', '10:00', BERLIN)).toBeUndefined()
    // A time a DST gap skips moves forward by the gap, east and west of UTC (the server's generation does the same).
    expect(instantIn('2026-03-29', '02:30', BERLIN)).toBe('2026-03-29T01:30:00.000Z')
    expect(instantIn('2026-03-08', '02:30', NEW_YORK)).toBe('2026-03-08T07:30:00.000Z')
    // A day keeps its whole length: 25 hours the night the clocks go back, 23 the night they go forward.
    const length = (day: string) => Date.parse(dayEndIn(day, BERLIN)!) + 1 - Date.parse(dayStartIn(day, BERLIN)!)
    expect(length('2026-10-25')).toBe(25 * HOUR)
    expect(length('2026-03-29')).toBe(23 * HOUR)
    expect(dayStartIn('2026-13-01', BERLIN)).toBeUndefined()
    expect(dayEndIn(undefined, BERLIN)).toBeUndefined()
  })

  it('is what the lessons, assignments and exams screens import under their old names', () => {
    expect(lessonsFormat.sameTimeZone).toBe(sameTimeZone)
    expect(lessonsFormat.differsFromDevice).toBe(differsFromDevice)
    expect(lessonsFormat.zonedPartsOf).toBe(wallClockIn)
    expect(lessonsFormat.toInstant).toBe(instantIn)
    expect(lessonsFormat.dayStartInstant).toBe(dayStartIn)
    expect(lessonsFormat.dayEndInstant).toBe(dayEndIn)
    // The exams screens import these from the assignments module.
    expect(assignmentsZone.academyZoneOf).toBe(academyTimeZoneOf)
    expect(assignmentsZone.differsFromDevice).toBe(differsFromDevice)
    expect(assignmentsZone.wallClockIn).toBe(wallClockIn)
    expect(assignmentsZone.instantIn).toBe(instantIn)
    expect(assignmentsZone.dayStartIn).toBe(dayStartIn)
    expect(assignmentsZone.dayEndIn).toBe(dayEndIn)
  })
})
