import { useTranslation } from 'react-i18next'
import { DEFAULT_LANGUAGE, isLanguage } from './language'
import type { Language, LocalizedText } from './language'

/** Returns the active language and a picker for bilingual text values. */
export function useLocalized() {
  const { i18n } = useTranslation()
  const language: Language = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE
  const localized = (text: LocalizedText) => text[language]
  return { language, localized }
}
