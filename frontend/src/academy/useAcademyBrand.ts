// The academy's name and logo for the app shell (J-F13, MOD-02-T04), from the
// shared GET /api/academy read (useAcademy). The brand is decoration: while the
// first read runs the name is empty (no flash of the static name before the
// real one — J-F24); after a failure (503 academy_not_configured included) or
// without a usable name the static `common.academyName` shows — never an error
// banner. The rules themselves are pure (academy.brand.ts).
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { academyBrandName, brandLogoSrc, isBrandPending } from './academy.brand'
import { useAcademy } from './useAcademy'

export interface AcademyBrand {
  /** The server's name in the UI language (Arabic fallback); '' while the first read runs; else `common.academyName`. */
  name: string
  /** An `https:` URL (`http:` on an `http:` page) or a root-relative path on this origin; null = no image. */
  logoSrc: string | null
}

export function useAcademyBrand(): AcademyBrand {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const reading = useAcademy()
  const fallback = isBrandPending(reading) ? '' : t('common.academyName')
  return {
    name: academyBrandName(reading.academy, language) ?? fallback,
    logoSrc: brandLogoSrc(reading.academy?.logoUrl, window.location.origin),
  }
}
