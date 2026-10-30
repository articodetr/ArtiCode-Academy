import { describe, expect, it } from 'vitest'
import { absoluteLink, isAcceptablePassword, isTokenShaped } from './account.links'

describe('isTokenShaped', () => {
  it('accepts exactly 43 base64url characters and nothing else', () => {
    expect(isTokenShaped('a'.repeat(43))).toBe(true)
    expect(isTokenShaped('Ab9_-'.padEnd(43, 'z'))).toBe(true)
    expect(isTokenShaped('a'.repeat(42))).toBe(false)
    expect(isTokenShaped('a'.repeat(44))).toBe(false)
    expect(isTokenShaped('a'.repeat(42) + '=')).toBe(false)
    expect(isTokenShaped('a'.repeat(42) + '/')).toBe(false)
    expect(isTokenShaped('')).toBe(false)
    expect(isTokenShaped(undefined)).toBe(false)
  })
})

describe('absoluteLink', () => {
  it('keeps an absolute link from APP_PUBLIC_URL untouched', () => {
    expect(absoluteLink('https://academy.example/invite/abc', 'http://localhost:5173')).toBe('https://academy.example/invite/abc')
    expect(absoluteLink('HTTP://academy.example/x', 'http://localhost:5173')).toBe('HTTP://academy.example/x')
  })

  it('completes a root-relative link with the origin of this app, whatever the slashes', () => {
    expect(absoluteLink('/invite/abc', 'http://localhost:5173')).toBe('http://localhost:5173/invite/abc')
    expect(absoluteLink('/invite/abc', 'http://localhost:5173/')).toBe('http://localhost:5173/invite/abc')
    expect(absoluteLink('reset-password/abc', 'https://academy.example')).toBe('https://academy.example/reset-password/abc')
  })
})

describe('isAcceptablePassword', () => {
  it('mirrors the MOD-01 policy: 10–128 characters, not only whitespace', () => {
    expect(isAcceptablePassword('Secret123!')).toBe(true)
    expect(isAcceptablePassword('Secret123')).toBe(false)
    expect(isAcceptablePassword(' '.repeat(12))).toBe(false)
    expect(isAcceptablePassword('x'.repeat(128))).toBe(true)
    expect(isAcceptablePassword('x'.repeat(129))).toBe(false)
  })
})
