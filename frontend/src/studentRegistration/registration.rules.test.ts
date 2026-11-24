import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, FULL_NAME_MAX_LENGTH, changedFullName, emailProblem, fullNameProblem } from './registration.rules'

describe('fullNameProblem', () => {
  it('accepts 2..200 characters after trimming', () => {
    expect(fullNameProblem('سا')).toBeNull()
    expect(fullNameProblem('  سارة علي  ')).toBeNull()
    expect(fullNameProblem('a'.repeat(FULL_NAME_MAX_LENGTH))).toBeNull()
    expect(fullNameProblem(`  ${'a'.repeat(FULL_NAME_MAX_LENGTH)}  `)).toBeNull()
  })

  it('names the problem in the server codes', () => {
    for (const value of [undefined, null, '', 42]) expect(fullNameProblem(value)).toBe('required')
    expect(fullNameProblem('    ')).toBe('blank')
    expect(fullNameProblem(' a ')).toBe('too_short')
    expect(fullNameProblem('a'.repeat(FULL_NAME_MAX_LENGTH + 1))).toBe('too_long')
  })

  it('counts an emoji as one character', () => {
    expect(fullNameProblem('😀')).toBe('too_short')
    expect(fullNameProblem('😀'.repeat(FULL_NAME_MAX_LENGTH))).toBeNull()
  })
})

describe('emailProblem', () => {
  it('accepts an address, spaces around it included', () => {
    expect(emailProblem('s@example.test')).toBeNull()
    expect(emailProblem('  s.a+1@sub.example.test ')).toBeNull()
  })

  it('names the problem in the server codes', () => {
    for (const value of [undefined, null, '', 42]) expect(emailProblem(value)).toBe('required')
    expect(emailProblem('   ')).toBe('blank')
    for (const value of ['plain', 'a@b', '@example.test', 's@', 's @example.test', 's@@example.test']) {
      expect(emailProblem(value)).toBe('invalid_format')
    }
    expect(emailProblem(`${'a'.repeat(EMAIL_MAX_LENGTH)}@example.test`)).toBe('too_long')
  })
})

describe('changedFullName', () => {
  it('is undefined while the name is what the server showed, spaces aside', () => {
    expect(changedFullName('سارة علي', 'سارة علي')).toBeUndefined()
    expect(changedFullName('سارة علي', '  سارة علي ')).toBeUndefined()
    expect(changedFullName('سارة علي', undefined)).toBeUndefined()
  })

  it('is the trimmed new name otherwise', () => {
    expect(changedFullName('سارة علي', ' سارة أحمد ')).toBe('سارة أحمد')
  })
})
