import { describe, expect, it } from 'vitest'
import { makeAcademy } from '../test/academy'
import { NO_SCHEDULING_SETTINGS, schedulingSettingsOf } from './schedule.settings'

describe('schedulingSettingsOf', () => {
  it('reads weekStartsOn and workingDays, the days sorted and deduplicated', () => {
    expect(schedulingSettingsOf({ ...makeAcademy(), settings: { scheduling: { weekStartsOn: 6, workingDays: [4, 0, 0, 1] } } })).toEqual({ weekStartsOn: 6, workingDays: [0, 1, 4] })
    expect(schedulingSettingsOf({ settings: { scheduling: { weekStartsOn: null, workingDays: [2] } } })).toEqual({ weekStartsOn: null, workingDays: [2] })
  })

  it('reads null (no restriction) for an academy without settings, an unreadable value or an empty list', () => {
    expect(schedulingSettingsOf(makeAcademy())).toEqual(NO_SCHEDULING_SETTINGS)
    expect(schedulingSettingsOf(null)).toEqual(NO_SCHEDULING_SETTINGS)
    expect(schedulingSettingsOf({ settings: { scheduling: { weekStartsOn: '6', workingDays: [7] } } })).toEqual(NO_SCHEDULING_SETTINGS)
    expect(schedulingSettingsOf({ settings: { scheduling: { weekStartsOn: 2.5, workingDays: [] } } })).toEqual(NO_SCHEDULING_SETTINGS)
    expect(schedulingSettingsOf({ settings: { scheduling: 'none' } })).toEqual(NO_SCHEDULING_SETTINGS)
  })
})
