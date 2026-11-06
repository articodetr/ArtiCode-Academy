import { describe, expect, it } from 'vitest'
import { TEACHER_IDS } from '../test/classes'
import { ROOM_IDS, SLOT_IDS, makeSlot } from '../test/schedule'
import {
  draftListProblems,
  findDraftConflict,
  groupByWeekday,
  isCalendarDate,
  isSchedulable,
  newSlotDraft,
  orderedWeekdays,
  planScheduleReplacement,
  slotDraftsOf,
  slotProblems,
} from './schedule.model'
import type { SlotDraft } from './schedule.model'

const stored = () => slotDraftsOf([makeSlot()])[0]!

describe('schedule.model', () => {
  it('orders the week from weekStartsOn and falls back to Sunday', () => {
    expect(orderedWeekdays(6)).toEqual([6, 0, 1, 2, 3, 4, 5])
    expect(orderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(orderedWeekdays(null)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(orderedWeekdays(9)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('edits only the schedule of a planned, open or running class (mirror of the server rule)', () => {
    expect(['planned', 'open', 'running'].map((status) => isSchedulable(status as 'planned'))).toEqual([true, true, true])
    expect(['completed', 'cancelled'].map((status) => isSchedulable(status as 'completed'))).toEqual([false, false])
  })

  it('accepts a calendar date that names a real day only', () => {
    expect(isCalendarDate('2026-11-10')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-1-1')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })

  it('finds the problems of one row: required values, end after start, effectiveTo not before effectiveFrom, working days', () => {
    expect(slotProblems(newSlotDraft('new'), null)).toEqual({ weekday: 'weekday_required', startTime: 'start_required', endTime: 'end_required', effectiveFrom: 'from_required' })
    const draft: SlotDraft = { ...stored(), endTime: '10:00', effectiveTo: '2026-11-09' }
    expect(slotProblems(draft, [1, 2])).toEqual({ weekday: 'non_working_day', endTime: 'end_after_start', effectiveTo: 'to_not_before_from' })
    expect(slotProblems({ ...draft, endTime: '11:00', effectiveTo: '2026-11-10' }, [0])).toEqual({})
    expect(slotProblems({ ...draft, endTime: '11:00', effectiveTo: 'soon' }, null)).toEqual({ effectiveTo: 'to_invalid' })
    expect(slotProblems({ ...draft, endTime: '11:00', effectiveTo: null, startTime: '9:00' }, null)).toEqual({ startTime: 'start_required' })
  })

  it('finds a room or a teacher double-booked inside the list, never adjacent, disjoint or incomplete rows', () => {
    const base = stored()
    const sameRoom: SlotDraft = { ...base, key: 'b', id: undefined, startTime: '10:30', endTime: '12:00', teacherUserId: null }
    expect(findDraftConflict([base, sameRoom])).toEqual({ kind: 'room', first: 0, second: 1 })
    expect(findDraftConflict([base, { ...sameRoom, roomId: ROOM_IDS[1], teacherUserId: TEACHER_IDS[0] }])).toEqual({ kind: 'teacher', first: 0, second: 1 })
    // Half-open times: 10:00–11:00 and 11:00–12:00 do not overlap.
    expect(findDraftConflict([base, { ...sameRoom, startTime: '11:00' }])).toBeNull()
    // Inclusive effective ranges: a slot starting the day after the other ends is fine.
    expect(findDraftConflict([{ ...base, effectiveTo: '2026-12-20' }, { ...sameRoom, effectiveFrom: '2026-12-21' }])).toBeNull()
    expect(findDraftConflict([{ ...base, effectiveTo: '2026-12-20' }, { ...sameRoom, effectiveFrom: '2026-12-20' }])).toEqual({ kind: 'room', first: 0, second: 1 })
    expect(findDraftConflict([base, { ...sameRoom, weekday: 1 }])).toBeNull()
    expect(findDraftConflict([base, { ...sameRoom, startTime: '' }])).toBeNull()
    expect(findDraftConflict([{ ...base, roomId: null, teacherUserId: null }, { ...sameRoom, roomId: null }])).toBeNull()
  })

  it('sends nothing when the drafts are the stored slots in any order, and the whole list otherwise', () => {
    const slots = [makeSlot(), makeSlot({ id: SLOT_IDS[1], weekday: 2, room: null, teacher: null, effectiveTo: '2026-12-20' })]
    const drafts = slotDraftsOf(slots)
    expect(planScheduleReplacement(slots, [drafts[1]!, drafts[0]!])).toBeNull()
    expect(planScheduleReplacement(slots, [drafts[0]!])).toEqual({
      slots: [{ id: SLOT_IDS[0], weekday: 0, startTime: '10:00', endTime: '11:00', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-10', effectiveTo: null }],
    })
    const added: SlotDraft = { ...newSlotDraft('new-1', { weekday: 3, effectiveFrom: '2026-11-11' }), startTime: '09:00', endTime: '10:00' }
    expect(planScheduleReplacement(slots, [{ ...drafts[0]!, endTime: '11:30' }, drafts[1]!, added])).toEqual({
      slots: [
        { id: SLOT_IDS[0], weekday: 0, startTime: '10:00', endTime: '11:30', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-10', effectiveTo: null },
        { id: SLOT_IDS[1], weekday: 2, startTime: '10:00', endTime: '11:00', roomId: null, teacherUserId: null, effectiveFrom: '2026-11-10', effectiveTo: '2026-12-20' },
        { weekday: 3, startTime: '09:00', endTime: '10:00', roomId: null, teacherUserId: null, effectiveFrom: '2026-11-11', effectiveTo: null },
      ],
    })
    // The same id twice is never "unchanged" (the server would answer schedule_invalid).
    expect(planScheduleReplacement(slots, [drafts[0]!, drafts[0]!])).not.toBeNull()
    expect(planScheduleReplacement([], [])).toBeNull()
  })

  it('collects the problems of a list: rows by key, the first conflict, too many rows', () => {
    const base = stored()
    expect(draftListProblems([base], null)).toBeNull()
    const incomplete = draftListProblems([base, { ...base, key: 'x', id: undefined, startTime: '' }], [0])
    expect(incomplete?.rows.get('x')).toEqual({ startTime: 'start_required' })
    expect(incomplete?.rows.has(base.key)).toBe(false)
    expect(incomplete?.conflict).toBeNull()
    expect(incomplete?.tooMany).toBe(false)
    const clash = draftListProblems([base, { ...base, key: 'y', id: undefined }], null)
    expect(clash?.conflict).toEqual({ kind: 'room', first: 0, second: 1 })
    const many = Array.from({ length: 51 }, (_, index) => ({ ...base, key: `k${index}`, id: undefined, roomId: null, teacherUserId: null }))
    expect(draftListProblems(many, null)).toEqual({ rows: new Map(), conflict: null, tooMany: true })
  })

  it('groups the slots by weekday in the week order, skipping days without slots', () => {
    const slots = [makeSlot({ weekday: 0 }), makeSlot({ id: SLOT_IDS[1], weekday: 6 }), makeSlot({ id: SLOT_IDS[2], weekday: 0, startTime: '12:00', endTime: '13:00' })]
    expect(groupByWeekday(slots, orderedWeekdays(6)).map((group) => [group.weekday, group.slots.map((slot) => slot.id)])).toEqual([
      [6, [SLOT_IDS[1]]],
      [0, [SLOT_IDS[0], SLOT_IDS[2]]],
    ])
    expect(groupByWeekday([], orderedWeekdays(null))).toEqual([])
  })
})
