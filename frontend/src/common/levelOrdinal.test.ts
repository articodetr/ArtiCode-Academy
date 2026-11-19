import { describe, expect, it } from 'vitest'
import { arabicOrdinal, levelOrdinalWord } from './levelOrdinal'

describe('level ordinals (MOD-20, D-R130)', () => {
  it('names 1..99 by the masculine Arabic ordinal word and anything else by its digits', () => {
    expect([1, 2, 3, 10, 11, 12, 19, 20, 21, 22, 35, 50, 99, 100, 0].map(arabicOrdinal)).toEqual([
      'الأول',
      'الثاني',
      'الثالث',
      'العاشر',
      'الحادي عشر',
      'الثاني عشر',
      'التاسع عشر',
      'العشرون',
      'الحادي والعشرون',
      'الثاني والعشرون',
      'الخامس والثلاثون',
      'الخمسون',
      'التاسع والتسعون',
      '100',
      '0',
    ])
  })

  it('gives the Arabic word in Arabic and the number in English', () => {
    expect(levelOrdinalWord(11, 'ar')).toBe('الحادي عشر')
    expect(levelOrdinalWord(11, 'en')).toBe('11')
  })
})
