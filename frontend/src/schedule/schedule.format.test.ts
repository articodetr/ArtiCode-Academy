import { describe, expect, it } from 'vitest'
import { makeMyItem, makeRoom, makeSlot } from '../test/schedule'
import { academyRow, dateParam, matchesRoom, myRow, orderRows, roomLabel, timeRange, weekdayKey, weekdayOrder } from './schedule.format'

describe('weekdays', () => {
  it('maps 0–6 to the day keys and orders the week from any start day', () => {
    expect(weekdayKey(0)).toBe('sun')
    expect(weekdayKey(6)).toBe('sat')
    expect(weekdayKey(7)).toBe('sun')
    expect(weekdayOrder()).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })
})

describe('orderRows', () => {
  it('sorts by the week order, then start time, keeps the server order otherwise, and marks the first row of each day', () => {
    const rows = [
      { id: 'b', weekday: 1, startTime: '09:00' },
      { id: 'a', weekday: 0, startTime: '10:00' },
      { id: 'c', weekday: 6, startTime: '08:00' },
      { id: 'd', weekday: 0, startTime: '10:00' },
      { id: 'e', weekday: 0, startTime: '08:30' },
    ]
    expect(orderRows(rows).map((row) => [row.id, row.firstOfDay])).toEqual([
      ['e', true],
      ['a', false],
      ['d', false],
      ['b', true],
      ['c', true],
    ])
    expect(orderRows(rows, 6).map((row) => row.id)).toEqual(['c', 'e', 'a', 'd', 'b'])
    expect(orderRows([])).toEqual([])
  })
})

describe('rows', () => {
  it('flattens an academy slot and a «my schedule» item into the shared row shape', () => {
    const slot = academyRow(makeSlot({ room: { id: 'r', code: 'HALL', name: null, branch: { id: 'b', code: 'IST', name: { ar: 'إسطنبول' } } } }), 'ar')
    expect(slot).toMatchObject({
      key: slot.slotId,
      weekday: 0,
      startTime: '10:00',
      endTime: '11:30',
      timeZone: 'Asia/Riyadh',
      classCode: 'PY-101-A',
      className: 'بايثون — الفصل أ',
      courseName: 'أساسيات بايثون',
      teacherName: 'خالد المعلم',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      relation: null,
      studentName: null,
    })
    expect(slot.room?.branch?.code).toBe('IST')
    expect(academyRow(makeSlot({ teacher: null }), 'en').teacherName).toBeNull()
    expect(academyRow(makeSlot(), 'en').className).toBe('Python — class A')

    const child = myRow(makeMyItem({ relation: 'child', student: { id: 's', fullName: 'أحمد', displayName: 'حمّودي' }, teacher: { fullName: 'منى', displayName: null } }), 'ar')
    expect(child).toMatchObject({ relation: 'child', studentName: 'حمّودي', teacherName: 'منى' })
    expect(child.key).toContain(':child:s')
    const mine = myRow(makeMyItem({ relation: 'teacher', student: null, teacher: null }), 'ar')
    expect(mine).toMatchObject({ relation: 'teacher', studentName: null, teacherName: null })
  })
})

describe('labels and params', () => {
  it('formats times, rooms and date filters, and matches rooms by code, names and branch', () => {
    expect(timeRange('10:00', '11:30')).toBe('10:00 – 11:30')
    expect(roomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'ar')).toBe('LAB-1 — مختبر 1')
    expect(roomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'en')).toBe('LAB-1 — Lab 1')
    expect(roomLabel({ code: 'HALL', name: null }, 'ar')).toBe('HALL')
    expect(dateParam('2026-11-10')).toBe('2026-11-10')
    expect(dateParam('')).toBeUndefined()
    expect(dateParam('10/11/2026')).toBeUndefined()
    const room = makeRoom({ branch: { id: 'b', code: 'IST', name: { ar: 'إسطنبول' } } })
    expect(matchesRoom(room, '')).toBe(true)
    expect(matchesRoom(room, 'lab')).toBe(true)
    expect(matchesRoom(room, 'مختبر')).toBe(true)
    expect(matchesRoom(room, 'ist')).toBe(true)
    expect(matchesRoom(room, 'hall')).toBe(false)
    expect(matchesRoom(makeRoom({ name: null }), 'lab')).toBe(true)
  })
})
