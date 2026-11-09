// Pure rules of the academy's brand in the app shell (J-F13, MOD-02-T04):
// which name to show, when to show none yet, and which logo address may be
// loaded. No React; unit-tested in academy.brand.test.ts.
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
 * True while the first read of the academy runs — no row and no failure yet:
 * the shell shows no name rather than flashing the static `common.academyName`
 * before the real one on every full load (J-F24). Once the read failed (503
 * included) the static name shows, during a retry too; once a row arrived its
 * name (or the static one, without a usable name) stays while it is re-read.
 */
export function isBrandPending(reading: { academy: unknown; loading: boolean; error: unknown }): boolean {
  return reading.loading && reading.academy === null && reading.error === null
}

/** The page's own scheme (`http:` or `https:`), or null when its origin is opaque (`"null"`). */
function pageProtocol(origin: string): string | null {
  try {
    return new URL(origin).protocol
  } catch {
    return null
  }
}

/**
 * The address the header may load the logo from, or null for no image: an
 * absolute `https:` URL; an absolute `http:` URL only while the page itself is
 * served over `http:` (on an `https:` page it would be mixed content — J-F24);
 * or a root-relative path that stays on this page's `origin` (`//host/…` and
 * `/\host/…` look root-relative but reach another host). Anything else —
 * `data:`, `javascript:`, a relative path — shows no logo. The server accepts
 * any absolute http(s) URL (API-036), so on an `https:` site an `http:` logo is
 * saved but not shown; the settings form says so under the logo field.
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
    if (url.hostname === '') return null
    if (url.protocol === 'https:') return url.href
    return url.protocol === 'http:' && pageProtocol(origin) === 'http:' ? url.href : null
  } catch {
    return null
  }
}
