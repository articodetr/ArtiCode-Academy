// The academy's name on the public pages: from API-205 in the UI language
// (Arabic fallback), nothing while the read runs, and after a failed read a
// neutral «الأكاديمية» — never the product's name: the public pages are the
// academy's own site (PORTAL-04, #208 — «لا تثبت علامة ArtiCode على موقع العميل»).
import { useTranslation } from 'react-i18next'
import { academyBrandName } from '../academy/academy.brand'
import type { PublicAcademyReading } from '../academy/usePublicAcademy'
import { useLocalized } from '../i18n/useLocalized'

export function useBrandName(reading: PublicAcademyReading): string {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return academyBrandName(reading.academy, language) ?? (reading.loading ? '' : t('publicCatalog.header.academyFallback'))
}
