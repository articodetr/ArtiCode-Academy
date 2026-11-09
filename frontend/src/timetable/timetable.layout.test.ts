import { describe, expect, it } from 'vitest'
import { clockMinutes } from './timetable.dates'
import { densityOf, hourHeightOf, hourRangeOf, hoursOf, layoutDay, nowMarkerIndex, verticalBox, visibleWeekdays } from './timetable.layout'

function slot(id: string, start: string, end: string) {
  return { id, startMinutes: clockMinutes(start), endMinutes: clockMinutes(end) }
}

function columnsOf(items: Array<ReturnType<typeof slot>>) {
  return Object.fromEntries(layoutDay(items).map(({ item, column, columns }) => [item.id, [column, columns]]))
}

describe('hour range and boxes', () => {
  it('keeps the 08–17 frame and widens it to whole hours around early or late slots', () => {
    expect(hourRangeOf([])).toEqual({ startHour: 8, endHour: 17 })
    expect(hourRangeOf([slot('a', '09:00', '11:00')])).toEqual({ startHour: 8, endHour: 17 })
    expect(hourRangeOf([slot('a', '07:30', '09:00'), slot('b', '18:00', '20:15')])).toEqual({ startHour: 7, endHour: 21 })
    expect(hourRangeOf([slot('a', '00:00', '23:59')])).toEqual({ startHour: 0, endHour: 24 })
    expect(hoursOf({ startHour: 8, endHour: 10 })).toEqual([8, 9, 10])
    expect(hourHeightOf({ startHour: 8, endHour: 17 })).toBe(64)
    expect(hourHeightOf({ startHour: 7, endHour: 21 })).toBe(52)
  })

  it('places a card at its start time with a height equal to its duration', () => {
    const range = { startHour: 8, endHour: 17 }
    expect(verticalBox(clockMinutes('09:00'), clockMinutes('11:00'), range, 64)).toEqual({ top: 64, height: 128 })
    expect(verticalBox(clockMinutes('10:30'), clockMinutes('11:15'), range, 64)).toEqual({ top: 160, height: 48 })
    expect(verticalBox(clockMinutes('08:00'), clockMinutes('08:30'), range, 52)).toEqual({ top: 0, height: 26 })
    expect(densityOf(26)).toBe('tiny')
    expect(densityOf(48)).toBe('compact')
    expect(densityOf(96)).toBe('regular')
    expect(densityOf(128)).toBe('full')
  })
})

describe('overlapping slots', () => {
  it('keeps separate and back-to-back slots full width (half-open ranges, as the EXCLUDE constraints)', () => {
    expect(columnsOf([slot('a', '09:00', '10:00'), slot('b', '10:00', '11:00'), slot('c', '12:00', '13:00')])).toEqual({ a: [0, 1], b: [0, 1], c: [0, 1] })
    expect(layoutDay([])).toEqual([])
  })

  it('puts overlapping slots side by side and shares the column count across a cluster', () => {
    expect(columnsOf([slot('a', '09:00', '11:00'), slot('b', '10:00', '12:00')])).toEqual({ a: [0, 2], b: [1, 2] })
    // a overlaps b and b overlaps c, a and c do not: c takes a's column back; the three share two columns.
    expect(columnsOf([slot('a', '09:00', '10:30'), slot('b', '10:00', '12:00'), slot('c', '11:00', '12:30')])).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2] })
    // Equal starts: the longer slot first, then by id.
    expect(columnsOf([slot('x', '09:00', '10:00'), slot('y', '09:00', '11:00'), slot('z', '09:00', '10:00')])).toEqual({ y: [0, 3], x: [1, 3], z: [2, 3] })
    // A later, separate cluster starts again at one column.
    expect(columnsOf([slot('a', '09:00', '11:00'), slot('b', '10:00', '12:00'), slot('d', '13:00', '14:00')]).d).toEqual([0, 1])
  })
})

describe('visible days', () => {
  const fromSaturday = [6, 0, 1, 2, 3, 4, 5]

  it('shows the working days in the academy order, plus any day that holds a slot or is selected', () => {
    expect(visibleWeekdays(fromSaturday, { workingDays: null, showAll: false, busy: new Set(), selected: 0 })).toEqual(fromSaturday)
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: false, busy: new Set(), selected: 1 })).toEqual([0, 1, 2, 3, 4])
    // Friday holds a slot and Saturday is selected: neither is hidden although both are days off.
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: false, busy: new Set([5]), selected: 6 })).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: true, busy: new Set(), selected: 1 })).toEqual(fromSaturday)
  })

  it('shows the filtered weekday alone', () => {
    expect(visibleWeekdays(fromSaturday, { workingDays: [0, 1, 2, 3, 4], showAll: true, busy: new Set([1]), selected: 1, onlyWeekday: 3 })).toEqual([3])
  })
})

describe('the now marker of the phone timeline (J-F17)', () => {
  const day = [slot('a', '09:00', '10:00'), slot('b', '11:00', '12:30'), slot('c', '14:00', '15:30')]

  it('sits before the first slot that has not started yet', () => {
    expect(nowMarkerIndex(day, clockMinutes('08:00'))).toBe(0)
    // During a slot: right after it (it has started), before the next one.
    expect(nowMarkerIndex(day, clockMinutes('09:30'))).toBe(1)
    expect(nowMarkerIndex(day, clockMinutes('10:30'))).toBe(1)
    // A slot that starts now has started.
    expect(nowMarkerIndex(day, clockMinutes('11:00'))).toBe(2)
  })

  it('stays after the last slot while it runs and once the day is over; no marker on another day', () => {
    expect(nowMarkerIndex(day, clockMinutes('14:45'))).toBe(3)
    expect(nowMarkerIndex(day, clockMinutes('20:00'))).toBe(3)
    expect(nowMarkerIndex(day, null)).toBeNull()
    expect(nowMarkerIndex([], clockMinutes('10:00'))).toBe(0)
  })
})
