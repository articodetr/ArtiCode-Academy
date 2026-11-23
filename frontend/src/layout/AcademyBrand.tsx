// The academy's brand in the app shell (J-F13, MOD-02-T04): its logo and name
// at the start of the header, and its name (or, on the icon rail, its logo or
// initial) at the top of the side menu, where the product's name stood until
// the 2026-11-22 redesign — from GET /api/academy (API-035) through the read that the settings
// tab and the calendar share (useAcademy), so a saved PATCH (API-036) shows
// here without a page reload. While the first read runs the name is empty, and
// the static `common.academyName` shows only after a failure or without a
// usable name (useAcademyBrand); a failure shows no banner. The logo is
// decorative (`alt=""`): the name beside it is the one accessible name — on a
// phone it is visually hidden, never `display: none` (AppLayout.css, J-F24).
import { useState } from 'react'
import { useAcademyBrand } from '../academy/useAcademyBrand'

export function HeaderBrand() {
  const { name, logoSrc } = useAcademyBrand()
  // A logo that failed to load is hidden; another address (after a save) is tried again.
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const logo = logoSrc !== null && logoSrc !== brokenLogo ? logoSrc : null

  return (
    <div className={logo ? 'app-header__brand' : 'app-header__brand app-header__brand--no-logo'}>
      {logo ? <img className="app-header__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} /> : null}
      {/* dir="auto": a Latin name in the Arabic UI (or the reverse) keeps its own order and is cut at its own end. */}
      <bdi dir="auto" className="app-header__title" title={name || undefined}>
        {name}
      </bdi>
    </div>
  )
}

/** The first letter of the name (a whole code point — never half a surrogate pair), upper-cased for a Latin name. */
function brandInitial(name: string): string {
  const [first = ''] = Array.from(name.trim())
  return first.toLocaleUpperCase()
}

/**
 * The top of the side menu: the ACADEMY's name, never the product's — the ArtiCode brand does not replace the
 * client's own in its dashboard (the «Admin Dashboard Modern Redesign» spec, 2026-11-22). On the icon rail (collapsed)
 * the academy's logo, else the first letter of its name. Nothing while the first read runs (J-F24): the line keeps its
 * height. The name is the one in the header too, so both are decorative to a screen reader there (the letter is hidden,
 * the logo's alt is empty); the full name shows on hover.
 */
export function SiderBrand({ collapsed }: { collapsed: boolean }) {
  const { name, logoSrc } = useAcademyBrand()
  const [brokenLogo, setBrokenLogo] = useState<string | null>(null)
  const logo = logoSrc !== null && logoSrc !== brokenLogo ? logoSrc : null

  if (collapsed) {
    return (
      <div className="app-brand app-brand--rail" title={name || undefined}>
        {logo ? (
          <img className="app-brand__logo" src={logo} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBrokenLogo(logo)} />
        ) : name ? (
          <span className="app-brand__mark" aria-hidden="true">
            {brandInitial(name)}
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="app-brand">
      {/* dir="auto": a Latin name in the Arabic UI (or the reverse) keeps its own order and is cut at its own end. */}
      <bdi dir="auto" className="app-brand__title" title={name || undefined}>
        {name}
      </bdi>
    </div>
  )
}

