// The academy's public home page (/home — PORTAL-04, #208, PR-1): who the
// academy is and what it teaches, for anybody, signed in or not — no
// `PublicOnly` here: a signed-in learner finds «مدرستي», staff the dashboard.
// API-205 (`/api/academy/public`, read once here and handed to the shell) gives
// the name, the logo and whether the catalog is public; API-236 the first
// programs. The section that fails fails alone. Nothing on the page is invented:
// no figure, testimonial, teacher name or contact detail the server does not
// send (the hero text, «about», contact details and featured programs are
// backend requirements — master doc PORTAL-04). `/` stays the protected dashboard.
// The page lays out full-width bands (`bleed`): the welcome, the programs, the
// steps and — for a visitor of an open catalog with programs to show — a closing band.
import { useTranslation } from 'react-i18next'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { useAuth } from '../auth/auth-context'
import { PublicShell } from '../publicCatalog/PublicShell'
import { PublicTitle } from '../publicCatalog/PublicTitle'
import { useBrandName } from '../publicCatalog/useBrandName'
import { viewerOf } from '../publicCatalog/publicViewer'
import { HomeCallToAction } from '../publicHome/HomeCallToAction'
import { HomeHero } from '../publicHome/HomeHero'
import { HomePrograms } from '../publicHome/HomePrograms'
import { HomeSteps } from '../publicHome/HomeSteps'
import { catalogOpenOf } from '../publicHome/publicHome.view'
import { useHomePrograms } from '../publicHome/useHomePrograms'
import '../publicHome/publicHome.css'

export function PublicHomePage() {
  const { t } = useTranslation()
  const academy = usePublicAcademy()
  const programs = useHomePrograms()
  const { status, user } = useAuth()
  const viewer = viewerOf(status, user)
  const name = useBrandName(academy)
  const knownName = academy.academy ? name : ''
  const catalogOpen = catalogOpenOf(programs.state, academy.academy)

  return (
    <PublicShell academy={academy} catalogOpen={catalogOpen} bleed>
      {/* The tab shows the academy's name while the page is open, and the description speaks in its name. */}
      <PublicTitle description={knownName ? t('publicHome.meta.descriptionNamed', { name: knownName }) : t('publicHome.meta.description')} />
      <div className="public-home">
        <HomeHero name={knownName} nameLoading={academy.loading} viewer={viewer} catalogOpen={catalogOpen} />
        <HomePrograms programs={programs} viewer={viewer} />
        <HomeSteps />
        <HomeCallToAction viewer={viewer} catalogOpen={catalogOpen} hasPrograms={programs.state === 'ready'} />
      </div>
    </PublicShell>
  )
}
