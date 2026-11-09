import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { SYSTEM_ROLE_KEYS, displayNameOf, formatDateTime, formatDay, localizedLabel, roleFilterKeys, roleLabel, roleLabelsOf } from './users.format'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

describe('roleLabel', () => {
  it('translates the system roles through the UI role vocabulary', () => {
    expect(roleLabel('academy_admin', t)).toBe(ar.roles.admin)
    expect(roleLabel('teacher', t)).toBe(ar.roles.teacher)
    expect(roleLabel('guardian', t)).toBe(ar.roles.guardian)
  })

  it('falls back to the key for a custom role when no labels of API-022 are at hand', () => {
    expect(roleLabel('exam_supervisor', t)).toBe('exam_supervisor')
    expect(roleLabel('exam_supervisor', t, new Map())).toBe('exam_supervisor')
  })

  it('shows a custom role by its server label, and keeps the translation of a system role (J-F12)', () => {
    const labels = new Map([
      ['librarian', 'أمين المكتبة'],
      ['teacher', 'Teacher (server)'],
    ])
    expect(roleLabel('librarian', t, labels)).toBe('أمين المكتبة')
    expect(roleLabel('teacher', t, labels)).toBe(ar.roles.teacher)
    // A role the labels do not know (created after the page loaded) stays raw.
    expect(roleLabel('exam_supervisor', t, labels)).toBe('exam_supervisor')
  })
})

describe('roleLabelsOf', () => {
  it('keys the labels of API-022 in the active language, Arabic when that language is missing, in server order', () => {
    const roles = [
      { key: 'teacher', label: { ar: 'معلم', en: 'Teacher' } },
      { key: 'librarian', label: { ar: 'أمين المكتبة', en: 'Librarian' } },
      { key: 'registrar', label: { ar: 'مسجّل' } },
    ]
    expect(roleLabelsOf(roles, 'ar').labels.get('librarian')).toBe('أمين المكتبة')
    const english = roleLabelsOf(roles, 'en')
    expect(english.labels.get('librarian')).toBe('Librarian')
    expect(english.labels.get('registrar')).toBe('مسجّل')
    expect(english.keys).toEqual(['teacher', 'librarian', 'registrar'])
  })
})

describe('roleFilterKeys', () => {
  it('offers the five system roles in menu order, then every other role of API-022 in server order', () => {
    expect(roleFilterKeys([])).toEqual([...SYSTEM_ROLE_KEYS])
    // API-022 sorts the system roles by key; the filter keeps its menu order and lists each role once.
    expect(roleFilterKeys(['academy_admin', 'guardian', 'staff', 'student', 'teacher', 'librarian', 'registrar'])).toEqual([
      'academy_admin',
      'staff',
      'teacher',
      'guardian',
      'student',
      'librarian',
      'registrar',
    ])
  })
})

describe('localizedLabel', () => {
  it('picks the active language and falls back to the mandatory Arabic', () => {
    expect(localizedLabel({ ar: 'معلم', en: 'Teacher' }, 'en')).toBe('Teacher')
    expect(localizedLabel({ ar: 'معلم', en: 'Teacher' }, 'ar')).toBe('معلم')
    expect(localizedLabel({ ar: 'مشرف' }, 'en')).toBe('مشرف')
  })
})

describe('date formatting', () => {
  it('shows a dash for missing values and echoes unparseable input', () => {
    expect(formatDateTime(null, 'ar')).toBe('—')
    expect(formatDay(undefined, 'en')).toBe('—')
    expect(formatDay('not-a-date', 'en')).toBe('not-a-date')
  })

  it('formats a calendar day in UTC so the day never shifts, with Latin digits in Arabic', () => {
    expect(formatDay('2012-05-01', 'en')).toBe('1 May 2012')
    const arabic = formatDay('2012-05-01', 'ar')
    expect(arabic).toContain('2012')
    expect(arabic).toContain('1')
    expect(arabic).not.toMatch(/[٠-٩]/)
  })

  it('formats a timestamp with date and time', () => {
    const text = formatDateTime('2026-10-28T10:30:00.000Z', 'en')
    expect(text).toContain('2026')
    expect(text).toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('displayNameOf', () => {
  it('prefers a non-blank display name over the full name', () => {
    expect(displayNameOf({ fullName: 'سارة أحمد', displayName: 'سارة' })).toBe('سارة')
    expect(displayNameOf({ fullName: 'سارة أحمد', displayName: '   ' })).toBe('سارة أحمد')
    expect(displayNameOf({ fullName: 'سارة أحمد', displayName: null })).toBe('سارة أحمد')
  })
})
