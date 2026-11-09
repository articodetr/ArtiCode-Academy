import { describe, expect, it } from 'vitest'
import { normalizeSpaces } from './text'

// TEST-143 (J-F26): the comparisons of Intl output must not depend on the ICU's space characters.
describe('normalizeSpaces', () => {
  it('turns every run of Unicode spaces into one ASCII space and trims, as jest-dom does to the received text', () => {
    expect(normalizeSpaces('29 November – 5 December 2026')).toBe('29 November – 5 December 2026')
    expect(normalizeSpaces('8 Nov 2026, 10:05 AM')).toBe('8 Nov 2026, 10:05 AM')
    expect(normalizeSpaces('  10:00  –\n\t11:30  ')).toBe('10:00 – 11:30')
    expect(normalizeSpaces('الأحد، 8 نوفمبر 2026')).toBe('الأحد، 8 نوفمبر 2026')
  })

  it('changes nothing but spaces: no space is added around a dash, and digits, Arabic and direction marks stay', () => {
    expect(normalizeSpaces('8–12 November 2026')).toBe('8–12 November 2026')
    expect(normalizeSpaces('08‏/11‏/2026')).toBe('08‏/11‏/2026')
    expect(normalizeSpaces('10:00 – 11:30')).toBe('10:00 – 11:30')
    expect(normalizeSpaces('')).toBe('')
  })
})
