// The academy's brand in the app shell (J-F13, MOD-02-T04): its logo and name
// at the start of the header, and its name under the product name in the side
// menu — from GET /api/academy (API-035) through the read that the settings
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

export function SiderAcademyName() {
  const { name } = useAcademyBrand()
  return (
    <bdi dir="auto" className="app-brand__sub" title={name || undefined}>
      {name}
    </bdi>
  )
}
