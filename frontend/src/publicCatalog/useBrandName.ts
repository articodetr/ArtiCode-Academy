// The academy's name on the public pages: from API-205 in the UI language
// (Arabic fallback), nothing while the read runs, the static product name after a failure.
import { useTranslation } from 'react-i18next'
import { academyBrandName } from '../academy/academy.brand'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { useLocalized } from '../i18n/useLocalized'

export function useBrandName(reading: PublicAcademyReading): string {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return academyBrandName(reading.academy, language) ?? (reading.loading ? '' : t('common.appName'))
}
