import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../account/account.links'
import {
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  confirmationProblem,
  emailProblem,
  fullNameProblem,
  passwordProblem,
} from './registration.rules'

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

describe('passwordProblem', () => {
  it(`accepts the invitation's policy: ${PASSWORD_MIN_LENGTH}..${PASSWORD_MAX_LENGTH} characters, not only spaces`, () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull()
    expect(passwordProblem('a'.repeat(PASSWORD_MAX_LENGTH))).toBeNull()
    // Spaces count as typed: a password is never trimmed.
    expect(passwordProblem(' Secret12 ')).toBeNull()
  })

  it('names what is wrong', () => {
    for (const value of [undefined, null, '', 42]) expect(passwordProblem(value)).toBe('required')
    expect(passwordProblem('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('policy')
    expect(passwordProblem('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe('policy')
    expect(passwordProblem(' '.repeat(PASSWORD_MIN_LENGTH))).toBe('policy')
  })
})

describe('confirmationProblem', () => {
  it('accepts an exact repeat only', () => {
    expect(confirmationProblem('Secret123!x', 'Secret123!x')).toBeNull()
    expect(confirmationProblem('Secret123!x', 'Secret123!x ')).toBe('mismatch')
    expect(confirmationProblem('Secret123!x', 'secret123!x')).toBe('mismatch')
    expect(confirmationProblem(undefined, 'Secret123!x')).toBe('mismatch')
  })

  it('asks for a missing confirmation', () => {
    for (const value of [undefined, null, '']) expect(confirmationProblem('Secret123!x', value)).toBe('required')
  })
})
