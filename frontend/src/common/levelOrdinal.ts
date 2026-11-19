// The one rule for naming a curriculum level (MOD-20, D-R130): «المستوى الأول»,
// «المستوى الحادي عشر», «المستوى الثاني والعشرون» … in Arabic — the masculine
// ordinal word of 1..99, as «المستوى» is masculine — and the number beyond;
// «Level 1», «Level 11» in English. The curriculum editor, the learning
// workspace and the public catalog all call it, so one level has one name on
// every screen. Unit-tested in levelOrdinal.test.ts.
import type { Language } from '../i18n/language'

const UNITS = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع'] as const
const TENS = ['', 'العاشر', 'العشرون', 'الثلاثون', 'الأربعون', 'الخمسون', 'الستون', 'السبعون', 'الثمانون', 'التسعون'] as const

/** The Arabic ordinal word of 1..99 (masculine): الأول، الحادي عشر، الثاني والعشرون …; the digits of any other value. */
export function arabicOrdinal(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 99) return String(value)
  const tens = Math.floor(value / 10)
  const units = value % 10
  if (tens === 0) return UNITS[units]!
  if (units === 0) return TENS[tens]!
  // «الحادي» — not «الأول» — in a compound number.
  const unit = units === 1 ? 'الحادي' : UNITS[units]!
  if (tens === 1) return `${unit} عشر`
  return `${unit} و${TENS[tens]!}`
}

/** The ordinal part of a level's name in the UI language: the Arabic word, or the number in English. */
export function levelOrdinalWord(number: number, language: Language): string {
  return language === 'ar' ? arabicOrdinal(number) : String(number)
}
