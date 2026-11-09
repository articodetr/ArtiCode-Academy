// Pure rules of the academy's brand in the app shell (J-F13, MOD-02-T04):
// which name to show and which logo address may be loaded. No React;
// unit-tested in academy.brand.test.ts.
import type { Academy } from '../api/academy'
import type { Language } from '../i18n/language'
import { localizedLabel } from '../users/users.format'

/** The academy's name in the UI language, falling back to the mandatory Arabic; null without a usable name. */
export function academyBrandName(academy: Pick<Academy, 'name'> | null | undefined, language: Language): string | null {
  const name = academy?.name
  if (!name || typeof name.ar !== 'string') return null
  const shown = localizedLabel(name, language)
  return typeof shown === 'string' && shown.trim() ? shown.trim() : null
}

/**
 * The address the header may load the logo from, or null for no image: an
 * absolute `https:` URL, or a root-relative path that stays on this page's
 * `origin` (`//host/…` and `/\host/…` look root-relative but reach another
 * host). Anything else — `http:` (mixed content on an https page), `data:`,
 * `javascript:`, a relative path — shows no logo. The server accepts any
 * absolute http(s) URL (API-036), so an `http:` logo is saved but not shown.
 */
export function brandLogoSrc(logoUrl: string | null | undefined, origin: string): string | null {
  const value = typeof logoUrl === 'string' ? logoUrl.trim() : ''
  if (!value) return null
  try {
    if (value.startsWith('/')) {
      const page = new URL(origin)
      const resolved = new URL(value, page)
      return resolved.origin === page.origin ? resolved.href : null
    }
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== '' ? url.href : null
  } catch {
    return null
  }
}
