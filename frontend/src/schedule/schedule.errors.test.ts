import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { CLASS_ID, TEACHER_IDS } from '../test/classes'
import { OTHER_CLASS_ID, ROOM_IDS, makeSlot } from '../test/schedule'
import { describeScheduleFailure, isStaleFailure, scheduleFailureMessage } from './schedule.errors'
import { newSlotDraft, slotDraftsOf } from './schedule.model'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const english = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ...options, lng: 'en' })

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

describe('describeScheduleFailure', () => {
  it('finds the refused row by the values the server echoes, with one message per resource and scope', () => {
    // The editor's list: a kept slot (row 1), then a new one (row 2).
    const fresh = { ...newSlotDraft('new-1', { weekday: 1, effectiveFrom: '2026-11-09' }), startTime: '09:00', endTime: '10:00', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0] }
    const drafts = [...slotDraftsOf([makeSlot()]), fresh]
    const echoed = { weekday: 1, startTime: '09:00', endTime: '10:00', roomId: ROOM_IDS[0], teacherUserId: TEACHER_IDS[0], effectiveFrom: '2026-11-09', effectiveTo: null }
    // Seen in the real-backend run: against another class the index counts the slots the server WRITES (new ones
    // first), so index 0 is row 2 here — the UI used to name and highlight row 1.
    const other = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'teacher', slot: { index: 0, ...echoed }, conflictingSlotId: 'slot-9', conflictingClassId: OTHER_CLASS_ID }), CLASS_ID, {}, drafts)
    expect(other).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict.teacher.other', params: { slot: '2' }, slotIndex: 1 })
    expect(scheduleFailureMessage(t, other)).toBe('المعلم محجوز لفصل آخر في وقت متداخل (الحصة 2).')

    // Also seen: one shared template gave «القاعة محجوز» (wrong agreement).
    const roomOther = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: { index: 0, ...echoed }, conflictingSlotId: 'slot-9', conflictingClassId: OTHER_CLASS_ID }), CLASS_ID, {}, drafts)
    expect(scheduleFailureMessage(t, roomOther)).toBe('القاعة محجوزة لفصل آخر في وقت متداخل (الحصة 2).')
    expect(scheduleFailureMessage(english, roomOther)).toBe('The room is already booked by another class at an overlapping time (slot 2).')

    // Inside the list the index is the request index: trusted when no row matches the values.
    const request = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: { index: 0 }, conflictingSlotId: null, conflictingClassId: CLASS_ID }), CLASS_ID)
    expect(request).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict.room.request', params: { slot: '1' }, slotIndex: 0 })
    expect(scheduleFailureMessage(t, request)).toBe('القاعة محجوزة لحصة أخرى في القائمة نفسها في وقت متداخل (الحصة 1).')

    // Another class but no row with those values, or no slot at all: the message names no row.
    const unmatched = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: { index: 0, ...echoed, startTime: '07:00' }, conflictingSlotId: 'slot-9', conflictingClassId: OTHER_CLASS_ID }), CLASS_ID, {}, drafts)
    expect(unmatched).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict.room.unknown' })
    const unknown = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: null, conflictingSlotId: null, conflictingClassId: null }), CLASS_ID)
    expect(unknown).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict.room.unknown' })
    expect(scheduleFailureMessage(t, unknown)).toBe('القاعة محجوزة في وقت متداخل؛ راجع الحصص ثم أعد المحاولة.')
    expect(isStaleFailure(unknown)).toBe(false)
  })

  it('names the room, the teacher, the weekday and the status the server refused', () => {
    const names = { roomOf: (roomId: string) => (roomId === ROOM_IDS[0] ? 'LAB-1 — مختبر 1' : undefined), teacherOf: (userId: string) => (userId === TEACHER_IDS[0] ? 'خالد المعلم' : undefined) }
    expect(scheduleFailureMessage(t, describeScheduleFailure(apiError(422, { code: 'room_inactive', roomId: ROOM_IDS[0] }), CLASS_ID, names))).toBe('القاعة «LAB-1 — مختبر 1» موقوفة؛ اختر قاعة نشطة.')
    expect(scheduleFailureMessage(t, describeScheduleFailure(apiError(404, { code: 'room_not_found', roomId: ROOM_IDS[1] }), CLASS_ID, names))).toBe(`القاعة «${ROOM_IDS[1]}» لم تعد موجودة.`)
    expect(scheduleFailureMessage(t, describeScheduleFailure(apiError(422, { code: 'teacher_not_assigned', userId: TEACHER_IDS[0] }), CLASS_ID, names))).toBe('«خالد المعلم» ليس من معلمي هذا الفصل.')
    expect(scheduleFailureMessage(t, describeScheduleFailure(apiError(422, { code: 'non_working_day', weekday: 5 }), CLASS_ID))).toBe('يوم الجمعة خارج أيام الدوام المضبوطة في إعدادات الأكاديمية.')
    const frozen = describeScheduleFailure(apiError(409, { code: 'class_not_schedulable', status: 'completed' }), CLASS_ID)
    expect(scheduleFailureMessage(t, frozen)).toBe('لا يُعدَّل جدول فصل مكتمل أو ملغى (الحالة: مكتمل).')
    expect(isStaleFailure(frozen)).toBe(true)
    expect(isStaleFailure(describeScheduleFailure(apiError(400, { code: 'schedule_invalid', unknown: ['x'], duplicates: [] }), CLASS_ID))).toBe(true)
  })

  it('maps the guards, validation and transport failures', () => {
    expect(describeScheduleFailure(apiError(403, { code: 'permission_denied', missing: ['schedule.manage'] }), CLASS_ID)).toEqual({
      code: 'permission_denied',
      key: 'classSchedule.errors.permission_denied',
      params: { list: '(schedule.manage)' },
    })
    expect(describeScheduleFailure(apiError(400, { message: 'endTime must be later than startTime' }), CLASS_ID)).toEqual({
      key: 'classSchedule.errors.validation',
      params: { message: 'endTime must be later than startTime' },
    })
    expect(describeScheduleFailure(apiError(503, { message: 'down' }), CLASS_ID)).toEqual({ key: 'login.errors.server' })
    expect(describeScheduleFailure(new TypeError('Failed to fetch'), CLASS_ID)).toEqual({ key: 'login.errors.network' })
    expect(describeScheduleFailure(apiError(418, { code: 'teapot' }), CLASS_ID)).toEqual({ key: 'login.errors.generic' })
  })
})
