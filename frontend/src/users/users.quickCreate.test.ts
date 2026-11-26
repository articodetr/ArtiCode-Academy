import { describe, expect, it } from 'vitest'
import { buildQuickCreateInput, isOtherUserKind, isQuickCreateKind, normalizePhone, phoneProblem } from './users.quickCreate'

describe('normalizePhone', () => {
  it('drops spaces, dashes, dots and brackets and turns a leading 00 into +', () => {
    expect(normalizePhone('00966 50 000 0001')).toBe('+966500000001')
    expect(normalizePhone('+90 (555) 123-45.67')).toBe('+905551234567')
    expect(normalizePhone('  +966-50-000-0001  ')).toBe('+966500000001')
  })

  it('reads Arabic-Indic digits and ignores the direction marks a copied number can carry', () => {
    expect(normalizePhone('٠٠٩٦٦٥٠٠٠٠٠٠٠١')).toBe('+966500000001')
    expect(normalizePhone('۰۰۹۰۵۵۵۱۲۳۴۵۶۷')).toBe('+905551234567')
    expect(normalizePhone('‎+966 50 000 0001‏')).toBe('+966500000001')
  })

  it('leaves anything else for the format check (a local number keeps its leading 0)', () => {
    expect(normalizePhone('0500000001')).toBe('0500000001')
    expect(normalizePhone('')).toBe('')
  })
})

describe('phoneProblem', () => {
  it('lets a student leave the backup phone empty and requires a teacher’s', () => {
    expect(phoneProblem('student', undefined)).toBeNull()
    expect(phoneProblem('student', '   ')).toBeNull()
    expect(phoneProblem('teacher', undefined)).toBe('required')
    expect(phoneProblem('teacher', ' - ')).toBe('required')
  })

  it('checks the normalised value against E.164', () => {
    expect(phoneProblem('student', '00966 50 000 0001')).toBeNull()
    expect(phoneProblem('teacher', '+966500000001')).toBeNull()
    expect(phoneProblem('teacher', '0500000001')).toBe('format')
    expect(phoneProblem('student', '+0123456789')).toBe('format')
    expect(phoneProblem('student', '+12345')).toBe('format')
  })
})

describe('buildQuickCreateInput', () => {
  it('sends the kind, the trimmed name and the lower-cased e-mail only when no phone is given', () => {
    expect(buildQuickCreateInput('student', { fullName: '  عمر خالد ', email: ' Omar@Test.Local ', phone: '  ' })).toEqual({
      kind: 'student',
      fullName: 'عمر خالد',
      email: 'omar@test.local',
    })
  })

  it('adds the normalised phone', () => {
    expect(buildQuickCreateInput('teacher', { fullName: 'سارة أحمد', email: 'sara@test.local', phone: '00966 50 000 0001' })).toEqual({
      kind: 'teacher',
      fullName: 'سارة أحمد',
      email: 'sara@test.local',
      phone: '+966500000001',
    })
  })
})

describe('kinds', () => {
  it('splits the kinds between the quick form and the wizard', () => {
    expect(['student', 'teacher', 'staff', 'guardian', 'admin'].filter(isQuickCreateKind)).toEqual(['student', 'teacher'])
    expect(['student', 'teacher', 'staff', 'guardian', 'admin'].filter(isOtherUserKind)).toEqual(['staff', 'guardian'])
  })
})
