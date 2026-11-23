// The academy's public home page (/home — PORTAL-04, #208): who the
// academy is and what it teaches, for anybody, signed in or not — no
// `PublicOnly` here: a signed-in learner finds «مدرستي», staff the dashboard.
// API-205 (`/api/academy/public`, read once here and handed to the shell) gives
// the name, the logo and whether the catalog is public; API-236 the programs and
// the figures. The section that fails fails alone. Nothing on the page is invented:
// no figure, testimonial, teacher name, partner or contact detail the server does
// not send (the sections that wait for such content render nothing until they get
// it). `/` stays the protected dashboard.
// The page lays out full-width bands (`bleed`), one long scroll: the welcome, the
// features, the programs, the trust band, «about», the steps, the figures, the
// certificate, the promotional band, «why», the closing strip.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { usePublicAcademy } from '../academy/usePublicAcademy'
import { isSelfRegistrationOpen } from '../api/academy'
import { useAuth } from '../auth/auth-context'
import { PublicShell } from '../publicCatalog/PublicShell'
import { PublicTitle } from '../publicCatalog/PublicTitle'
import { useBrandName } from '../publicCatalog/useBrandName'
import { viewerOf } from '../publicCatalog/publicViewer'
import { HomeAbout, HomeCertificate, HomeFeatureStrip, HomePromo, HomeStatsBand, HomeTrustBand, HomeWhy } from '../publicHome/HomeBands'
import { HomeCallToAction } from '../publicHome/HomeCallToAction'
import { HomeHero } from '../publicHome/HomeHero'
import { HomePrograms } from '../publicHome/HomePrograms'
import { HomeArticles, HomeTestimonials } from '../publicHome/HomeRealContent'
import { HomeSteps } from '../publicHome/HomeSteps'
import { catalogOpenOf, homeProgramsPath } from '../publicHome/publicHome.view'
import { useHomePrograms } from '../publicHome/useHomePrograms'
import '../publicHome/publicHome.css'

export function PublicHomePage() {
  const { t } = useTranslation()
  const academy = usePublicAcademy()
  const programs = useHomePrograms()
  const { status, user, hasPermission } = useAuth()
  const viewer = viewerOf(status, user)
  const name = useBrandName(academy)
  const knownName = academy.academy ? name : ''
  const catalogOpen = catalogOpenOf(programs.state, academy.academy)
  const programsPath = homeProgramsPath(viewer, catalogOpen, hasPermission('courses.read'))
  // Only the server's `true`: the page then stops saying that accounts come from the administration alone.
  const registrationOpen = isSelfRegistrationOpen(academy.academy)
  const { hash, key } = useLocation()
  const programsState = programs.state

  // «من نحن» (`/home#about`), from this page or another: the router does not scroll to a hash. Asked again once the
  // programs have loaded, because their cards move the section down.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.()
  }, [hash, key, programsState])

  return (
    <PublicShell academy={academy} catalogOpen={catalogOpen} bleed>
      {/* The tab shows the academy's name while the page is open, and the description speaks in its name. */}
      <PublicTitle description={knownName ? t('publicHome.meta.descriptionNamed', { name: knownName }) : t('publicHome.meta.description')} />
      <div className="public-home">
        <HomeHero name={knownName} nameLoading={academy.loading} viewer={viewer} catalogOpen={catalogOpen} stats={programs.stats} registrationOpen={registrationOpen} />
        <HomeFeatureStrip />
        <HomePrograms programs={programs} viewer={viewer} />
        <HomeTrustBand />
        <HomeAbout programsPath={programsPath} />
        <HomeTestimonials items={[]} />
        <HomeSteps registrationOpen={registrationOpen} />
        <HomeStatsBand stats={programs.stats} />
        <HomeCertificate />
        <HomePromo programsPath={programsPath} />
        <HomeWhy />
        {/* The closing strip invites to enroll, so it needs a course that takes a learner now. */}
        <HomeCallToAction viewer={viewer} catalogOpen={catalogOpen} hasPrograms={programs.state === 'ready' && programs.joinable} />
        <HomeArticles items={[]} />
      </div>
    </PublicShell>
  )
}
