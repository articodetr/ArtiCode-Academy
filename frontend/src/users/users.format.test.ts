import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { displayNameOf, formatDateTime, formatDay, localizedLabel, roleLabel } from './users.format'

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options)

describe('roleLabel', () => {
  it('translates the system roles through the UI role vocabulary', () => {
    expect(roleLabel('academy_admin', t)).toBe(ar.roles.admin)
    expect(roleLabel('teacher', t)).toBe(ar.roles.teacher)
    expect(roleLabel('guardian', t)).toBe(ar.roles.guardian)
  })

  it('falls back to the key for a custom role', () => {
    expect(roleLabel('exam_supervisor', t)).toBe('exam_supervisor')
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
