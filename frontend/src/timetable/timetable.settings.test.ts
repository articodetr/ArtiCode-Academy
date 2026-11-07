import { describe, expect, it } from 'vitest'
import { deviceTimeZone, timetableSettingsOf } from './timetable.settings'

describe('timetableSettingsOf', () => {
  it('reads the academy zone and the weekly-schedule keys (working days sorted, without repeats)', () => {
    expect(timetableSettingsOf({ timezone: 'Asia/Riyadh', settings: { scheduling: { weekStartsOn: 6, workingDays: [4, 0, 1, 2, 3, 0] } } })).toEqual({
      timeZone: 'Asia/Riyadh',
      weekStartsOn: 6,
      workingDays: [0, 1, 2, 3, 4],
    })
  })

  it('falls back as the backend documents: Sunday first, every day, and this device zone without a readable academy', () => {
    expect(timetableSettingsOf({ timezone: 'UTC', settings: { scheduling: { weekStartsOn: null, workingDays: null } } })).toEqual({ timeZone: 'UTC', weekStartsOn: 0, workingDays: null })
    // The academy body before J-F02's type: no `settings` key at all.
    expect(timetableSettingsOf({ timezone: 'UTC' })).toEqual({ timeZone: 'UTC', weekStartsOn: 0, workingDays: null })
    expect(timetableSettingsOf({ timezone: 'UTC', settings: { scheduling: { weekStartsOn: 9, workingDays: [] } } })).toMatchObject({ weekStartsOn: 0, workingDays: null })
    expect(timetableSettingsOf({ timezone: 'UTC', settings: { scheduling: { weekStartsOn: 1.5, workingDays: [1, 'x'] } } })).toMatchObject({ weekStartsOn: 0, workingDays: null })
    expect(timetableSettingsOf({ timezone: 'UTC', settings: 'broken' })).toMatchObject({ weekStartsOn: 0, workingDays: null })
    expect(timetableSettingsOf(null)).toEqual({ timeZone: deviceTimeZone(), weekStartsOn: 0, workingDays: null })
    expect(timetableSettingsOf({ timezone: 'Nowhere/Zone' }).timeZone).toBe(deviceTimeZone())
  })
})
