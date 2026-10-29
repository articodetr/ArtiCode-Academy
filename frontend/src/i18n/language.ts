// Pure language helpers (no side effects). The i18next instance lives in ./index.ts.

export const SUPPORTED_LANGUAGES = ['ar', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'ar'

export type Direction = 'rtl' | 'ltr'

/** Text that the product stores in every supported language (mock data uses it). */
export type LocalizedText = Record<Language, string>

export function isLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

export function directionOf(language: Language): Direction {
  return language === 'ar' ? 'rtl' : 'ltr'
}
