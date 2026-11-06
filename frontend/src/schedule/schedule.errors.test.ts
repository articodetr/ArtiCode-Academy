import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { CLASS_ID, TEACHER_IDS } from '../test/classes'
import { OTHER_CLASS_ID, ROOM_IDS } from '../test/schedule'
import { describeScheduleFailure, isStaleFailure, scheduleFailureMessage } from './schedule.errors'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

describe('describeScheduleFailure', () => {
  it('names the resource, the refused row and the scope of a conflict', () => {
    const other = describeScheduleFailure(
      apiError(409, { code: 'schedule_conflict', kind: 'teacher', slot: { index: 1, weekday: 0 }, conflictingSlotId: 'slot-9', conflictingClassId: OTHER_CLASS_ID }),
      CLASS_ID,
    )
    expect(other).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict_other', resourceKey: 'classSchedule.resource.teacher', params: { slot: '2' }, slotIndex: 1 })
    expect(scheduleFailureMessage(t, other)).toBe('المعلم محجوز لفصل آخر في وقت متداخل (الحصة 2).')

    const request = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: { index: 0 }, conflictingSlotId: null, conflictingClassId: CLASS_ID }), CLASS_ID)
    expect(request.key).toBe('classSchedule.errors.schedule_conflict_request')
    expect(scheduleFailureMessage(t, request)).toBe('القاعة محجوز لحصة أخرى في القائمة نفسها في وقت متداخل (الحصة 1).')

    const unknown = describeScheduleFailure(apiError(409, { code: 'schedule_conflict', kind: 'room', slot: null, conflictingSlotId: null, conflictingClassId: null }), CLASS_ID)
    expect(unknown).toEqual({ code: 'schedule_conflict', key: 'classSchedule.errors.schedule_conflict_unknown', resourceKey: 'classSchedule.resource.room', params: { slot: '' } })
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
