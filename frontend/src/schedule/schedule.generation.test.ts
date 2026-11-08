import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import i18n from '../i18n'
import { CLASS_ID, TEACHER_IDS } from '../test/classes'
import { LESSON_ID, OTHER_CLASS_ID, ROOM_IDS } from '../test/schedule'
import { GENERATION_MAX_DAYS, defaultGenerationRange, describeGenerationFailure, generationFailureMessage, generationRangeProblems, hasRangeProblems, inclusiveDays } from './schedule.generation'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)
const english = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ...options, lng: 'en' })

function apiError(status: number, body: Record<string, unknown>) {
  return new ApiError(status, typeof body.message === 'string' ? body.message : 'error', { statusCode: status, ...body })
}

describe('generation range (mirror of IsGenerationRange)', () => {
  it('counts the days inclusively and accepts at most GENERATION_MAX_DAYS — 184 passes, 185 is refused', () => {
    expect(GENERATION_MAX_DAYS).toBe(184)
    expect(inclusiveDays('2026-11-15', '2026-11-15')).toBe(1)
    expect(inclusiveDays('2026-11-15', '2026-12-31')).toBe(47)
    // Across the end of February and a DST change elsewhere: dates are counted on UTC midnights.
    expect(inclusiveDays('2027-02-27', '2027-03-30')).toBe(32)
    expect(generationRangeProblems({ from: '2026-11-15', to: '2026-11-15' })).toEqual({})
    expect(generationRangeProblems({ from: '2026-11-15', to: '2027-05-17' })).toEqual({})
    expect(inclusiveDays('2026-11-15', '2027-05-17')).toBe(184)
    expect(generationRangeProblems({ from: '2026-11-15', to: '2027-05-18' })).toEqual({ to: 'range_too_long' })
  })

  it('refuses an end before the start and dates that are missing or not real', () => {
    expect(generationRangeProblems({ from: '2026-11-15', to: '2026-11-14' })).toEqual({ to: 'to_not_before_from' })
    expect(generationRangeProblems({ from: '', to: '2026-11-14' })).toEqual({ from: 'from_required' })
    expect(generationRangeProblems({ from: '2026-11-15', to: '2026-02-30' })).toEqual({ to: 'to_required' })
    const both = generationRangeProblems({ from: '15/11/2026', to: '' })
    expect(both).toEqual({ from: 'from_required', to: 'to_required' })
    expect(hasRangeProblems(both)).toBe(true)
    expect(hasRangeProblems({})).toBe(false)
  })

  it('starts at today or at the class start when later, and ends at the class end (cut to 184 days) or after four weeks', () => {
    const today = '2026-11-08'
    // A class that started already and ends within the limit: today → its last day.
    expect(defaultGenerationRange({ startsOn: '2026-11-01', endsOn: '2026-12-20' }, today)).toEqual({ from: '2026-11-08', to: '2026-12-20' })
    // A class that starts later: from its first day.
    expect(defaultGenerationRange({ startsOn: '2026-11-15', endsOn: '2026-12-31' }, today)).toEqual({ from: '2026-11-15', to: '2026-12-31' })
    // An end beyond the limit is cut to the 184th day.
    expect(defaultGenerationRange({ startsOn: null, endsOn: '2027-12-31' }, today)).toEqual({ from: '2026-11-08', to: '2027-05-10' })
    expect(inclusiveDays('2026-11-08', '2027-05-10')).toBe(GENERATION_MAX_DAYS)
    // No end date, or one before the start: four weeks.
    expect(defaultGenerationRange({ startsOn: null, endsOn: null }, today)).toEqual({ from: '2026-11-08', to: '2026-12-05' })
    expect(defaultGenerationRange({ startsOn: null, endsOn: '2026-11-01' }, today)).toEqual({ from: '2026-11-08', to: '2026-12-05' })
    expect(defaultGenerationRange({ startsOn: '2026-11-08', endsOn: '2026-11-08' }, today)).toEqual({ from: '2026-11-08', to: '2026-11-08' })
  })
})

describe('describeGenerationFailure', () => {
  it('names the resource, the scope and the conflicting lesson of a lesson_conflict, and points to the schedule', () => {
    const other = describeGenerationFailure(apiError(409, { code: 'lesson_conflict', resource: 'teacher', conflictingLessonId: LESSON_ID, conflictingClassId: OTHER_CLASS_ID }), CLASS_ID)
    expect(other).toEqual({
      code: 'lesson_conflict',
      key: 'classSchedule.generate.errors.lesson_conflict.teacher.other',
      conflictingLessonId: LESSON_ID,
      refused: true,
      fixInSchedule: true,
    })
    expect(generationFailureMessage(t, other)).toBe('المعلم محجوز بدرس في فصل آخر في وقت متداخل؛ عدّل ذلك الدرس أو الحصة ثم أعد التوليد.')
    expect(generationFailureMessage(english, other)).toBe(
      'The teacher is already booked by a lesson of another class at an overlapping time; edit that lesson or the slot, then generate again.',
    )

    // A manual lesson of the same class at that time (the generated one is not the same occurrence).
    const same = describeGenerationFailure(apiError(409, { code: 'lesson_conflict', resource: 'room', conflictingLessonId: LESSON_ID, conflictingClassId: CLASS_ID }), CLASS_ID)
    expect(generationFailureMessage(t, same)).toBe('القاعة محجوزة بدرس آخر من هذا الفصل في وقت متداخل؛ عدّل ذلك الدرس أو الحصة ثم أعد التوليد.')

    // The server could not name the blocking lesson.
    const unknown = describeGenerationFailure(apiError(409, { code: 'lesson_conflict', resource: 'room', conflictingLessonId: null, conflictingClassId: null }), CLASS_ID)
    expect(unknown).toEqual({ code: 'lesson_conflict', key: 'classSchedule.generate.errors.lesson_conflict.room.unknown', refused: true, fixInSchedule: true })
    expect(generationFailureMessage(t, unknown)).toBe('القاعة محجوزة بدرس قائم في وقت متداخل؛ عدّل الدرس أو الحصة ثم أعد التوليد.')
  })

  it('names the class status, the room and the teacher the server refused', () => {
    const names = { roomOf: (roomId: string) => (roomId === ROOM_IDS[0] ? 'LAB-1 — مختبر 1' : undefined), teacherOf: (userId: string) => (userId === TEACHER_IDS[0] ? 'خالد المعلم' : undefined) }
    const frozen = describeGenerationFailure(apiError(409, { code: 'class_not_schedulable', status: 'completed' }), CLASS_ID, names)
    expect(frozen).toMatchObject({ status: 'completed', refused: true, fixInSchedule: false })
    expect(generationFailureMessage(t, frozen)).toBe('لا تُولَّد دروس لفصل مكتمل أو ملغى (الحالة: مكتمل).')
    expect(generationFailureMessage(t, describeGenerationFailure(apiError(409, { code: 'class_closed', classId: CLASS_ID, status: 'cancelled' }), CLASS_ID))).toBe(
      'أُغلق الفصل أثناء التوليد (الحالة: ملغى).',
    )
    const inactive = describeGenerationFailure(apiError(422, { code: 'room_inactive', roomId: ROOM_IDS[0] }), CLASS_ID, names)
    expect(inactive.fixInSchedule).toBe(true)
    expect(generationFailureMessage(t, inactive)).toBe('القاعة «LAB-1 — مختبر 1» موقوفة؛ عدّل الحصة التي تستخدمها أو فعّل القاعة ثم أعد التوليد.')
    // Unknown to the screen: the id is shown.
    expect(generationFailureMessage(t, describeGenerationFailure(apiError(404, { code: 'room_not_found', roomId: ROOM_IDS[1] }), CLASS_ID, names))).toBe(
      `قاعة إحدى الحصص لم تعد موجودة («${ROOM_IDS[1]}»)؛ عدّل الحصة ثم أعد التوليد.`,
    )
    expect(generationFailureMessage(t, describeGenerationFailure(apiError(422, { code: 'teacher_not_assigned', userId: TEACHER_IDS[0] }), CLASS_ID, names))).toBe(
      '«خالد المعلم» ليس من معلمي هذا الفصل؛ عدّل الحصة ثم أعد التوليد.',
    )
    expect(generationFailureMessage(t, describeGenerationFailure(apiError(404, { code: 'class_not_found', classId: CLASS_ID }), CLASS_ID))).toBe('الفصل لم يعد موجوداً.')
  })

  it('maps the guards, validation and transport failures — a refusal wrote nothing, a lost answer is safe to retry', () => {
    const denied = describeGenerationFailure(apiError(403, { code: 'permission_denied', missing: ['schedule.manage'] }), CLASS_ID)
    expect(denied).toEqual({ code: 'permission_denied', key: 'classSchedule.errors.permission_denied', params: { list: '(schedule.manage)' }, refused: true, fixInSchedule: false })
    expect(generationFailureMessage(t, denied)).toBe('ليست لديك الصلاحية اللازمة لهذا الإجراء (schedule.manage)')
    expect(describeGenerationFailure(apiError(403, { code: 'origin_forbidden' }), CLASS_ID).key).toBe('classSchedule.errors.origin_forbidden')
    const invalid = describeGenerationFailure(apiError(400, { message: 'to must not be before from, and the range may cover at most 184 days' }), CLASS_ID)
    expect(generationFailureMessage(t, invalid)).toBe('رفض الخادم البيانات: to must not be before from, and the range may cover at most 184 days')
    expect(describeGenerationFailure(apiError(503, { message: 'down' }), CLASS_ID)).toEqual({ key: 'login.errors.server', refused: false, fixInSchedule: false })
    expect(describeGenerationFailure(new TypeError('Failed to fetch'), CLASS_ID)).toEqual({ key: 'login.errors.network', refused: false, fixInSchedule: false })
  })
})
