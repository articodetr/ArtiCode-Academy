import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import {
  LOW_RECOVERY_CODES,
  RECOVERY_CODES_FILE_NAME,
  compactCode,
  groupSecret,
  isLowOnRecoveryCodes,
  isTotpCode,
  normalizeRecoveryCode,
  recoveryCodesClipboardText,
  recoveryCodesFileText,
} from './mfa.format'

describe('groupSecret', () => {
  it('shows the Base32 secret in groups of four', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(groupSecret('JBSWY3DPEH')).toBe('JBSW Y3DP EH')
    expect(groupSecret('JBSW Y3DP')).toBe('JBSW Y3DP')
    expect(groupSecret('')).toBe('')
  })
})

describe('compactCode and isTotpCode', () => {
  it('drops the spaces of a typed code', () => {
    expect(compactCode('123 456')).toBe('123456')
    expect(compactCode(' 12 34 56\t')).toBe('123456')
  })

  it('reads Arabic-Indic and Persian digits as 0–9', () => {
    expect(compactCode('٠١٢ ٣٤٥')).toBe('012345')
    expect(compactCode('۶۷۸۹۰۱')).toBe('678901')
    expect(isTotpCode('١٢٣٤٥٦')).toBe(true)
  })

  it('accepts exactly six digits, with or without spaces', () => {
    expect(isTotpCode('492039')).toBe(true)
    expect(isTotpCode('492 039')).toBe(true)
    expect(isTotpCode('49203')).toBe(false)
    expect(isTotpCode('4920391')).toBe(false)
    expect(isTotpCode('49203a')).toBe(false)
    expect(isTotpCode('492-039')).toBe(false)
    expect(isTotpCode('')).toBe(false)
    expect(isTotpCode('   ')).toBe(false)
  })
})

describe('normalizeRecoveryCode', () => {
  it('returns the code as XXXXX-XXXXX in upper case, whatever the spaces, dashes and case typed', () => {
    expect(normalizeRecoveryCode('K7QX4-M9TRB')).toBe('K7QX4-M9TRB')
    expect(normalizeRecoveryCode('k7qx4m9trb')).toBe('K7QX4-M9TRB')
    expect(normalizeRecoveryCode(' k7qx4 - m9trb ')).toBe('K7QX4-M9TRB')
    expect(normalizeRecoveryCode('K7-QX4M9-TRB')).toBe('K7QX4-M9TRB')
  })

  it('refuses what cannot be a code: another length, a look-alike symbol, a non-ASCII letter', () => {
    expect(normalizeRecoveryCode('')).toBeNull()
    expect(normalizeRecoveryCode('K7QX4-M9TR')).toBeNull()
    expect(normalizeRecoveryCode('K7QX4-M9TRBB')).toBeNull()
    // 0, 1, I and O are not in the alphabet — refused, never guessed.
    expect(normalizeRecoveryCode('K7QX0-M9TRB')).toBeNull()
    expect(normalizeRecoveryCode('K7QX1-M9TRB')).toBeNull()
    expect(normalizeRecoveryCode('K7QXI-M9TRB')).toBeNull()
    expect(normalizeRecoveryCode('K7QXO-M9TRB')).toBeNull()
    // A dotless ı would become I when upper-cased.
    expect(normalizeRecoveryCode('K7QXı-M9TRB')).toBeNull()
    expect(normalizeRecoveryCode('K7QX4_M9TRB')).toBeNull()
  })
})

describe('isLowOnRecoveryCodes', () => {
  it(`warns from ${LOW_RECOVERY_CODES} codes down, never while two-step verification is off`, () => {
    expect(isLowOnRecoveryCodes(10)).toBe(false)
    expect(isLowOnRecoveryCodes(4)).toBe(false)
    expect(isLowOnRecoveryCodes(3)).toBe(true)
    expect(isLowOnRecoveryCodes(1)).toBe(true)
    expect(isLowOnRecoveryCodes(0)).toBe(true)
    expect(isLowOnRecoveryCodes(null)).toBe(false)
  })
})

describe('recovery codes as text', () => {
  const codes = ['K7QX4-M9TRB', 'P3ZWN-8HDCA']

  it('copies one code per line', () => {
    expect(recoveryCodesClipboardText(codes)).toBe('K7QX4-M9TRB\nP3ZWN-8HDCA')
  })

  it('builds the text file: BOM, title, date, the codes one per line, the hint — CRLF line ends, no account name', () => {
    const text = recoveryCodesFileText(codes, { title: 'رموز الاسترداد', generatedAt: 'أُنشئت في 16 نوفمبر 2026', hint: 'يصلح كل رمز مرة واحدة.' })
    expect(text).toBe('﻿رموز الاسترداد\r\nأُنشئت في 16 نوفمبر 2026\r\n\r\nK7QX4-M9TRB\r\nP3ZWN-8HDCA\r\n\r\nيصلح كل رمز مرة واحدة.\r\n')
  })

  it('names the file recovery-codes.txt', () => {
    expect(RECOVERY_CODES_FILE_NAME).toBe('recovery-codes.txt')
  })
})

describe('the message for a text that cannot be a recovery code', () => {
  it('states the whole rule normalizeRecoveryCode applies — ten symbols, XXXXX-XXXXX, never 0, 1, I or O — as the sign-in page does', () => {
    const messages = [
      ar.profile.mfa.validation.recoveryCodeShape,
      en.profile.mfa.validation.recoveryCodeShape,
      // The same refusal on the sign-in page: both pages must go on saying the same thing.
      ar.login.mfa.recoveryCodeFormat,
      en.login.mfa.recoveryCodeFormat,
    ]
    for (const message of messages) {
      expect(message).toContain('XXXXX-XXXXX')
      expect(message).toMatch(/(^|[^0-9])10([^0-9]|$)/)
      expect(message).toMatch(/0.+1.+I.+O/)
    }
    // …and the rule itself: what the message names is what the function refuses.
    for (const symbol of ['0', '1', 'I', 'O']) {
      expect(normalizeRecoveryCode(`K7QX${symbol}-M9TRB`)).toBeNull()
    }
    expect(normalizeRecoveryCode('K7QX4-M9TR')).toBeNull()
  })
})
