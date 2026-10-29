import { Segmented } from 'antd'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '../i18n'
import { DEFAULT_LANGUAGE, isLanguage } from '../i18n/language'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const current = isLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : DEFAULT_LANGUAGE

  return (
    <Segmented
      size="small"
      value={current}
      options={[
        { label: 'العربية', value: 'ar' },
        { label: 'English', value: 'en' },
      ]}
      onChange={(value) => {
        if (isLanguage(value)) void changeLanguage(value)
      }}
    />
  )
}
