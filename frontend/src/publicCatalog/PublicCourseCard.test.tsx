// PORTAL-04 PR-1 redesign: the public course card's media box (a cover, or a plain placeholder — also when the cover
// fails), the level badge on it, and the price at its foot. The link behaviour is covered by the catalog and home pages.
import { fireEvent, screen, within } from '@testing-library/react'
import { useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { makePublicCard } from '../test/publicCatalog'
import { makeAuth, makeUser, renderWithProviders } from '../test/render'
import { PublicCourseCard } from './PublicCourseCard'
import { PLACEHOLDER_TINTS, placeholderTintOf } from './publicCatalog.view'

const pc = ar.publicCatalog

function renderCard(overrides: Parameters<typeof makePublicCard>[0] = {}, href: string | null = '/explore/x') {
  const card = makePublicCard(overrides)
  renderWithProviders(<PublicCourseCard card={card} href={href} />)
  return within(screen.getByTestId(`public-card-${card.id}`))
}

describe('PublicCourseCard', () => {
  it('shows the cover over the placeholder, and the placeholder alone once the cover fails to load', () => {
    const card = renderCard()
    const cover = card.getByTestId('course-cover')
    expect(cover).toHaveAttribute('alt', '')
    expect(document.querySelector('.public-card__placeholder')).toHaveAttribute('aria-hidden', 'true')

    fireEvent.error(cover)
    expect(card.queryByTestId('course-cover')).not.toBeInTheDocument()
    expect(document.querySelector('.public-card__placeholder')).toBeInTheDocument()
  })

  it('draws a placeholder — never a picture — for a course without a cover, in a tint stable for that course', () => {
    renderCard({ coverImageUrl: null })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByTestId('course-cover')).not.toBeInTheDocument()
    const tint = placeholderTintOf(makePublicCard().id)
    expect(document.querySelector('.public-card__placeholder')).toHaveClass(`public-card__placeholder--t${tint}`)
    expect(placeholderTintOf(makePublicCard().id)).toBe(tint)
    expect(tint).toBeGreaterThanOrEqual(0)
    expect(tint).toBeLessThan(PLACEHOLDER_TINTS)
  })

  it('puts the level on the media box and the price at the foot', () => {
    const free = renderCard()
    expect(document.querySelector('.public-card__badge')).toHaveTextContent('مبتدئ')
    expect(free.getByTestId('public-price')).toHaveTextContent(pc.card.free)
  })

  it('never reads a paid course as free: its amount, or «السعر غير متاح حالياً» without a usable price', () => {
    const paid = renderCard({ pricing: 'paid', price: { amount: 450, currency: 'TRY' } })
    expect(paid.getByTestId('public-price')).not.toHaveTextContent(pc.card.free)
    expect(paid.getByTestId('public-price')).toHaveTextContent('450')
  })

  it('says why a paid course without a price cannot be joined, once', () => {
    const unpriced = renderCard({ pricing: 'paid', price: null, hasFreeSeat: false })
    expect(unpriced.getAllByText(pc.card.priceUnavailable)).toHaveLength(1)
    expect(unpriced.queryByText(pc.card.full)).not.toBeInTheDocument()
  })

  it('is a plain preview without a link: no «التفاصيل»', () => {
    const preview = renderCard({}, null)
    expect(preview.queryByRole('link')).not.toBeInTheDocument()
    expect(preview.queryByText(pc.list.details)).not.toBeInTheDocument()
  })

  describe('a course with no class open', () => {
    afterEach(async () => {
      await i18n.changeLanguage('ar')
    })
    const soon = { openClasses: 0, hasFreeSeat: false }

    it('reads «قريبًا» with no subscribe button, and can still be opened', () => {
      const card = renderCard(soon)
      expect(card.getByText('قريبًا')).toHaveClass('public-card__availability--closed')
      expect(card.queryByText(pc.card.closed)).not.toBeInTheDocument()
      expect(screen.queryByTestId(`public-subscribe-${makePublicCard().id}`)).not.toBeInTheDocument()
      expect(card.getByText(pc.list.details)).toBeInTheDocument()
    })

    it('reads "Coming soon" in English', async () => {
      await i18n.changeLanguage('en')
      const card = renderCard(soon)
      expect(card.getByText('Coming soon')).toBeInTheDocument()
      expect(card.queryByText(en.publicCatalog.card.closed)).not.toBeInTheDocument()
    })

    it('leaves «full» with its own words', () => {
      const card = renderCard({ hasFreeSeat: false })
      expect(card.getByText(pc.card.full)).toBeInTheDocument()
      expect(card.queryByText(pc.card.comingSoon)).not.toBeInTheDocument()
    })
  })

  describe('the subscribe button beside «التفاصيل»', () => {
    function Probe() {
      const location = useLocation()
      return <output data-testid="landed">{JSON.stringify({ path: location.pathname + location.search, from: (location.state as { from?: string } | null)?.from })}</output>
    }
    const visitor = () => makeAuth({ status: 'anonymous', user: null })
    function renderFor(auth: ReturnType<typeof makeAuth>, overrides: Parameters<typeof makePublicCard>[0] = {}) {
      const card = makePublicCard({ hasFreeSeat: true, openClasses: 1, ...overrides })
      renderWithProviders(<PublicCourseCard card={card} href={`/explore/${card.id}`} />, {
        auth,
        route: '/explore',
        path: '/explore',
        routes: { '/login': <Probe />, '/catalog/:courseId': <Probe /> },
      })
      return card
    }

    it('says «اشترك مجانًا» for a free course and leads a visitor through the sign-in, keeping the course', async () => {
      const card = renderFor(visitor())
      const button = screen.getByTestId(`public-subscribe-${card.id}`)
      expect(button).toHaveTextContent(pc.card.subscribeFree)
      expect(button).toHaveAccessibleName(`${pc.card.subscribeFree}: أساسيات بايثون`)
      fireEvent.click(button)
      expect(JSON.parse((await screen.findByTestId('landed')).textContent!)).toEqual({ path: '/login', from: `/catalog/${card.id}?intent=enroll` })
    })

    it('says «طلب الاشتراك» for a paid course', () => {
      const card = renderFor(visitor(), { pricing: 'paid', price: { amount: 150, currency: 'USD' } })
      expect(screen.getByTestId(`public-subscribe-${card.id}`)).toHaveTextContent(pc.card.subscribePaid)
      expect(within(screen.getByTestId(`public-card-${card.id}`)).getByText(pc.list.details)).toBeInTheDocument()
    })

    it('leads a signed-in student straight to the course’s classes', async () => {
      const card = renderFor(makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: [] }) }))
      fireEvent.click(screen.getByTestId(`public-subscribe-${card.id}`))
      expect(JSON.parse((await screen.findByTestId('landed')).textContent!).path).toBe(`/catalog/${card.id}?intent=enroll`)
    })

    it('keeps only «التفاصيل» when nobody can enroll now, and for staff or a guardian', () => {
      const full = renderFor(visitor(), { id: '00000000-0000-7000-8000-0000000000a1', hasFreeSeat: false })
      expect(screen.queryByTestId(`public-subscribe-${full.id}`)).not.toBeInTheDocument()
      const staff = renderFor(makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: [] }) }), { id: '00000000-0000-7000-8000-0000000000a2' })
      expect(screen.queryByTestId(`public-subscribe-${staff.id}`)).not.toBeInTheDocument()
      const guardian = renderFor(makeAuth({ user: makeUser({ role: 'guardian', roles: ['guardian'], permissions: [] }) }), { id: '00000000-0000-7000-8000-0000000000a3' })
      expect(screen.queryByTestId(`public-subscribe-${guardian.id}`)).not.toBeInTheDocument()
    })
  })
})
