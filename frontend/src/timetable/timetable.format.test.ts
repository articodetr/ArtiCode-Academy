import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { makeRoom } from '../test/timetable'
import {
  dayNumber,
  formatDate,
  formatDateRange,
  formatDayMonth,
  formatLongDate,
  formatMonthTitle,
  matchesRoom,
  personName,
  relationLabel,
  roomLabel,
  slotLabel,
  timeRange,
  weekdayKey,
  weekdayOrder,
} from './timetable.format'

const t = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('ar')(key, options)
const tEn = (key: string, options?: Record<string, unknown>) => i18n.getFixedT('en')(key, options)
const ARABIC_INDIC_DIGITS = /[٠-٩]/

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

describe('labels', () => {
  it('formats times, rooms and people, and matches rooms by code, names and branch', () => {
    expect(timeRange('10:00', '11:30')).toBe('10:00 – 11:30')
    expect(roomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'ar')).toBe('LAB-1 — مختبر 1')
    expect(roomLabel({ code: 'LAB-1', name: { ar: 'مختبر 1', en: 'Lab 1' } }, 'en')).toBe('LAB-1 — Lab 1')
    expect(roomLabel({ code: 'HALL', name: null }, 'ar')).toBe('HALL')
    expect(personName({ fullName: 'منى أحمد', displayName: '  ' })).toBe('منى أحمد')
    expect(personName({ fullName: 'أحمد', displayName: 'حمّودي' })).toBe('حمّودي')
    const room = makeRoom({ branch: { id: 'b', code: 'IST', name: { ar: 'إسطنبول' } } })
    expect(matchesRoom(room, '')).toBe(true)
    expect(matchesRoom(room, 'lab')).toBe(true)
    expect(matchesRoom(room, 'مختبر')).toBe(true)
    expect(matchesRoom(room, 'ist')).toBe(true)
    expect(matchesRoom(room, 'hall')).toBe(false)
  })

  it('names the relations of «my schedule» and builds the accessible name of a slot in both languages', () => {
    expect(relationLabel(t, { relation: 'self', student: { fullName: 'سارة', displayName: null } })).toBe('أنا')
    expect(relationLabel(t, { relation: 'child', student: { fullName: 'أحمد', displayName: 'حمّودي' } })).toBe('ابني/ابنتي: حمّودي')
    expect(relationLabel(t, { relation: 'teacher', student: null })).toBe('أُدرّسه')
    const slot = { courseName: 'أساسيات بايثون', classCode: 'PY-101-A', date: '2026-11-08', startTime: '10:00', endTime: '11:30', room: 'LAB-1 — مختبر 1', teacher: 'خالد', relations: ['أنا'] }
    expect(slotLabel(t, 'ar', slot)).toBe(`أساسيات بايثون، الفصل PY-101-A، ${formatLongDate('2026-11-08', 'ar')}، من 10:00 إلى 11:30، القاعة LAB-1 — مختبر 1، المعلم خالد، أنا`)
    expect(slotLabel(tEn, 'en', { ...slot, courseName: 'Python Basics', room: null, teacher: 'Khalid', relations: [] })).toBe(
      `Python Basics, class PY-101-A, ${formatLongDate('2026-11-08', 'en')}, 10:00 to 11:30, No room, teacher Khalid`,
    )
    // A slot without its own teacher reads «the lead teacher», not «teacher the lead teacher».
    expect(slotLabel(t, 'ar', { ...slot, teacher: null, relations: [] })).toBe(
      `أساسيات بايثون، الفصل PY-101-A، ${formatLongDate('2026-11-08', 'ar')}، من 10:00 إلى 11:30، القاعة LAB-1 — مختبر 1، المعلم الرئيسي`,
    )
  })
})

describe('calendar dates', () => {
  it('formats dates in Arabic with Latin digits and in English, never shifted by a time zone', () => {
    expect(dayNumber('2026-11-07')).toBe('07')
    const arabic = formatLongDate('2026-11-08', 'ar')
    expect(arabic).toContain('الأحد')
    expect(arabic).toContain('نوفمبر')
    expect(arabic).toContain('8')
    expect(arabic).toContain('2026')
    expect(arabic).not.toMatch(ARABIC_INDIC_DIGITS)
    expect(formatLongDate('2026-11-08', 'en')).toMatch(/Sunday.*8.*November.*2026/)
    expect(formatDate('2026-12-31', 'en')).toBe('31 December 2026')
    expect(formatDayMonth('2026-11-01', 'en')).toBe('1 November')
    expect(formatMonthTitle({ year: 2026, month: 11 }, 'en')).toBe('November 2026')
    expect(formatMonthTitle({ year: 2026, month: 11 }, 'ar')).toContain('نوفمبر')
  })

  it('writes the range of the shown week once per month', () => {
    const sameMonth = formatDateRange('2026-11-01', '2026-11-07', 'en')
    expect(sameMonth).toMatch(/^1\s?[–-]\s?7 November 2026$/)
    const acrossMonths = formatDateRange('2026-11-29', '2026-12-05', 'en')
    expect(acrossMonths).toContain('29 November')
    expect(acrossMonths).toContain('5 December 2026')
    expect(formatDateRange('2026-11-08', '2026-11-08', 'en')).toBe('8 November 2026')
    const arabic = formatDateRange('2026-11-01', '2026-11-07', 'ar')
    expect(arabic.match(/نوفمبر/g)).toHaveLength(1)
    expect(arabic).not.toMatch(ARABIC_INDIC_DIGITS)
  })
})
