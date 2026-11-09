// The academy's name and logo for the app shell (J-F13, MOD-02-T04), from the
// shared GET /api/academy read (useAcademy). The brand is decoration: while the
// row loads, after a failure (503 academy_not_configured included) or without a
// usable name, the static `common.academyName` stays — never an empty header,
// never an error banner. The rules themselves are pure (academy.brand.ts).
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { academyBrandName, brandLogoSrc } from './academy.brand'
import { useAcademy } from './useAcademy'

export interface AcademyBrand {
  /** The server's name in the UI language (Arabic fallback), else `common.academyName`. */
  name: string
  /** An `https:` URL or a root-relative path on this origin; null = no image. */
  logoSrc: string | null
}

export function useAcademyBrand(): AcademyBrand {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  return {
    name: academyBrandName(academy, language) ?? t('common.academyName'),
    logoSrc: brandLogoSrc(academy?.logoUrl, window.location.origin),
  }
}
