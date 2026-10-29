import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ar } from './ar'
import { en } from './en'
import {
  DEFAULT_LANGUAGE,
  directionOf,
  isLanguage,
  type Language,
} from './language'

const STORAGE_KEY = 'aca.language'

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // Storage can be unavailable (private mode, blocked site data); fall back.
  }
  return DEFAULT_LANGUAGE
}

function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = language
  document.documentElement.dir = directionOf(language)
}

export async function changeLanguage(language: Language) {
  await i18n.changeLanguage(language)
  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Persisting the choice is a convenience only.
  }
}

i18n.on('languageChanged', (lng) => {
  if (isLanguage(lng)) applyDocumentLanguage(lng)
})

const initialLanguage = readStoredLanguage()

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
})

applyDocumentLanguage(initialLanguage)

export default i18n
