import { describe, expect, it } from 'vitest'
import { certificatePrintPath, groupVerificationCode, myCertificatePrintPath, normalizeVerificationCode, verificationPath, verificationUrl } from './certificates.links'

describe('normalizeVerificationCode (mirror of the server rule — D-R56)', () => {
  it('accepts a code as a person may type it: lower case, spaces and hyphens', () => {
    expect(normalizeVerificationCode('K7Q2M4XWZPLR5TBC3NHD')).toBe('K7Q2M4XWZPLR5TBC3NHD')
    expect(normalizeVerificationCode('k7q2-m4xw-zplr-5tbc-3nhd')).toBe('K7Q2M4XWZPLR5TBC3NHD')
    expect(normalizeVerificationCode(' K7Q2 M4XW\tZPLR 5TBC 3NHD ')).toBe('K7Q2M4XWZPLR5TBC3NHD')
  })

  it('refuses what cannot be a code — the server answers it the same 404 without a lookup', () => {
    for (const raw of [undefined, null, '', 'SHORT', 'K7Q2M4XWZPLR5TB', 'K7Q2M4XWZPLR5TBC3NH0', 'K7Q2M4XWZPLR5TBC3NH1', 'ÄBCDEFGHIJKLMNOPQRS', 'A'.repeat(33)]) {
      expect(normalizeVerificationCode(raw)).toBeNull()
    }
    // 16 and 32 characters are the bounds of the stored form.
    expect(normalizeVerificationCode('A'.repeat(16))).toBe('A'.repeat(16))
    expect(normalizeVerificationCode('A'.repeat(32))).toBe('A'.repeat(32))
    // The controller reads the first 64 characters of the parameter only.
    expect(normalizeVerificationCode(`${'-'.repeat(60)}ABCDEFGHIJKLMNOPQRST`)).toBeNull()
  })
})

describe('certificate links', () => {
  it('groups a code by four for reading, and builds the public page and the printed link', () => {
    expect(groupVerificationCode('K7Q2M4XWZPLR5TBC3NHD')).toBe('K7Q2-M4XW-ZPLR-5TBC-3NHD')
    expect(groupVerificationCode('ABCDEF')).toBe('ABCD-EF')
    expect(verificationPath('K7Q2M4XWZPLR5TBC3NHD')).toBe('/verify/K7Q2M4XWZPLR5TBC3NHD')
    expect(verificationUrl('K7Q2M4XWZPLR5TBC3NHD', 'https://academy.example.test/')).toBe('https://academy.example.test/verify/K7Q2M4XWZPLR5TBC3NHD')
  })

  it('opens the print page of the academy route or of the owner route, the id encoded', () => {
    expect(certificatePrintPath('c-1')).toBe('/certificates/c-1/print')
    expect(myCertificatePrintPath('c/1')).toBe('/my-certificates/c%2F1/print')
  })
})
