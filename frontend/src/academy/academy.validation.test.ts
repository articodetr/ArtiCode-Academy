import { describe, expect, it } from 'vitest'
import { isCurrencyCode, isHttpUrl, isIanaTimeZone, matchTimeZones, normaliseCurrency, supportedTimeZones } from './academy.validation'

describe('academy validation mirrors', () => {
  it('knows the canonical IANA zones of the runtime plus UTC, sorted and resolved once', () => {
    const zones = supportedTimeZones()
    expect(zones.length).toBeGreaterThan(300)
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Riyadh')
    expect(zones).toEqual([...zones].sort())
    expect(supportedTimeZones()).toBe(zones)

    expect(isIanaTimeZone('Europe/Istanbul')).toBe(true)
    expect(isIanaTimeZone('UTC')).toBe(true)
    expect(isIanaTimeZone('Mars/Olympus')).toBe(false)
    expect(isIanaTimeZone('asia/riyadh')).toBe(false)
    expect(isIanaTimeZone('')).toBe(false)
  })

  it('matches zones by a case-insensitive substring, capped for the dropdown', () => {
    expect(matchTimeZones('riyadh')).toEqual(['Asia/Riyadh'])
    expect(matchTimeZones('ISTANBUL')).toEqual(['Europe/Istanbul'])
    expect(matchTimeZones('a', 5)).toHaveLength(5)
    expect(matchTimeZones('')).toHaveLength(20)
    expect(matchTimeZones('nowhere-at-all')).toEqual([])
  })

  it('normalises the currency like the server and checks the ISO 4217 shape', () => {
    expect(normaliseCurrency(' sar ')).toBe('SAR')
    expect(normaliseCurrency(undefined)).toBe('')
    for (const code of ['SAR', 'TRY', 'USD']) expect(isCurrencyCode(code), code).toBe(true)
    for (const code of ['sar', 'SA', 'SAR1', 'S4R', '']) expect(isCurrencyCode(code), code).toBe(false)
  })

  it('accepts absolute http(s) URLs only', () => {
    expect(isHttpUrl('https://cdn.example.test/logo.png')).toBe(true)
    expect(isHttpUrl('http://localhost:5173/logo.svg')).toBe(true)
    expect(isHttpUrl('ftp://cdn.example.test/logo.png')).toBe(false)
    expect(isHttpUrl('cdn.example.test/logo.png')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })
})
