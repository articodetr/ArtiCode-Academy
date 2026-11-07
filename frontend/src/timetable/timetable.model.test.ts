import { describe, expect, it } from 'vitest'
import type { TimetableSlot } from '../api/timetable'
import { SLOT_ID, STUDENT_ID, makeMyItem, makeSlot } from '../test/timetable'
import { entriesOfMine, entriesOn, entryOfSlot, occursOn, toneOf, TONE_COUNT, upcomingOccurrences } from './timetable.model'
import type { TimetableEntry } from './timetable.model'

const kid = (id: string, name: string) => ({ id, fullName: name, displayName: null })

describe('entries', () => {
  it('turns an academy slot into an entry with minutes and no relations', () => {
    const entry = entryOfSlot(makeSlot())
    expect(entry).toMatchObject({
      id: SLOT_ID,
      weekday: 0,
      startTime: '10:00',
      endTime: '11:30',
      startMinutes: 600,
      endMinutes: 690,
      timeZone: 'Asia/Riyadh',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      teacher: { fullName: 'خالد المعلم', displayName: null },
      relations: [],
    })
    expect(entry.class.code).toBe('PY-101-A')
    expect(entryOfSlot(makeSlot({ teacher: null })).teacher).toBeNull()
  })

  it('collects the «my schedule» items of one slot into ONE entry naming every relation once, in the server order', () => {
    const entries = entriesOfMine([
      makeMyItem({ relation: 'self' }),
      makeMyItem({ relation: 'child', student: kid('k-1', 'أحمد') }),
      makeMyItem({ relation: 'child', student: kid('k-2', 'سارة') }),
      makeMyItem({ relation: 'child', student: kid('k-1', 'أحمد') }),
      makeMyItem({ id: 'slot-2', weekday: 2, relation: 'teacher', student: null }),
    ])
    expect(entries.map((entry) => entry.id)).toEqual([SLOT_ID, 'slot-2'])
    expect(entries[0]!.relations.map((relation) => [relation.relation, relation.student?.id ?? null])).toEqual([
      ['self', STUDENT_ID],
      ['child', 'k-1'],
      ['child', 'k-2'],
    ])
    expect(entries[1]!.relations).toEqual([{ relation: 'teacher', student: null }])
  })
})

describe('dates a weekly slot occurs on', () => {
  it('recurs on its weekday inside the inclusive effective range (open end allowed)', () => {
    const entry = { weekday: 0, effectiveFrom: '2026-11-08', effectiveTo: '2026-11-22' }
    expect(occursOn(entry, '2026-11-08')).toBe(true)
    expect(occursOn(entry, '2026-11-22')).toBe(true)
    expect(occursOn(entry, '2026-11-29')).toBe(false)
    expect(occursOn(entry, '2026-11-01')).toBe(false)
    expect(occursOn(entry, '2026-11-09')).toBe(false)
    expect(occursOn({ ...entry, effectiveTo: null }, '2027-06-06')).toBe(true)
  })

  it('orders a day by start time, end time, then class code', () => {
    const late = entryOfSlot(makeSlot({ id: 'late', startTime: '12:00', endTime: '13:00' }))
    const longer = entryOfSlot(makeSlot({ id: 'longer', startTime: '09:00', endTime: '11:00' }))
    const shorter = entryOfSlot(makeSlot({ id: 'shorter', startTime: '09:00', endTime: '10:00' }))
    const otherDay = entryOfSlot(makeSlot({ id: 'monday', weekday: 1 }))
    expect(entriesOn([late, longer, otherDay, shorter], '2026-11-08').map((entry) => entry.id)).toEqual(['shorter', 'longer', 'late'])
  })
})

describe('upcoming occurrences', () => {
  // Sunday 2026-11-08, 08:30 in Riyadh (05:30Z).
  const now = Date.UTC(2026, 10, 8, 5, 30)
  const at = (id: string, start: string, end: string, extra: Partial<TimetableSlot> = {}): TimetableEntry =>
    entryOfSlot(makeSlot({ id, startTime: start, endTime: end, ...extra }))
  const ended = at('ended', '07:00', '08:00')
  const running = at('running', '08:00', '09:00')
  const later = at('later', '10:00', '11:00')
  // 08:15 in London is 08:15Z — after 10:00 in Riyadh (07:00Z) although its clock time is earlier.
  const london = at('london', '08:15', '09:15', { timeZone: 'Europe/London' })
  const monday = at('monday', '09:00', '10:00', { weekday: 1 })
  const byDate = new Map([
    ['2026-11-08', [ended, running, london, later]],
    ['2026-11-09', [monday]],
  ])

  it('lists what has not ended at now, soonest first by the instant in each slot zone', () => {
    const list = upcomingOccurrences(byDate, ['2026-11-08', '2026-11-09'], now, 10)
    expect(list.map((occurrence) => occurrence.entry.id)).toEqual(['running', 'later', 'london', 'monday'])
    expect(list[0]).toMatchObject({ date: '2026-11-08', startsAt: Date.UTC(2026, 10, 8, 5, 0), endsAt: Date.UTC(2026, 10, 8, 6, 0) })
    expect(list[3]!.date).toBe('2026-11-09')
  })

  it('keeps at most `limit` and skips an entry that does not occur on the date', () => {
    expect(upcomingOccurrences(byDate, ['2026-11-08', '2026-11-09'], now, 2).map((occurrence) => occurrence.entry.id)).toEqual(['running', 'later'])
    expect(upcomingOccurrences(new Map([['2026-11-09', [later]]]), ['2026-11-09'], now, 5)).toEqual([])
  })
})

describe('tones', () => {
  it('gives a course the same tone every time, within the palette', () => {
    expect(toneOf('course-a')).toBe(toneOf('course-a'))
    const tones = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(toneOf)
    expect(new Set(tones).size).toBeGreaterThan(1)
    expect(tones.every((tone) => tone >= 0 && tone < TONE_COUNT)).toBe(true)
  })
})
