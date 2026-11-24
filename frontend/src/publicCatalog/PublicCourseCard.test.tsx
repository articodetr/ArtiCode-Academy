// The public course card (the course redesign): its media box (a cover, or a plain placeholder — also when the cover
// fails), the badges on it, the price and the main button. The link behaviour is covered by the catalog and home pages,
// and the subscribe action, which lives on the course page, by PublicCoursePage.test.tsx.
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { ar } from '../i18n/ar'
import { en } from '../i18n/en'
import { HomeCourseCard } from '../publicHome/HomeCourseCard'
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

  it('puts the badges on the picture and the price under the facts', () => {
    const free = renderCard()
    const media = within(document.querySelector<HTMLElement>('.public-card__media')!)
    expect(media.getByText(pc.card.courseType)).toBeInTheDocument()
    expect(media.getByText('البرمجة')).toBeInTheDocument()
    expect(media.getByText('24 ساعة')).toBeInTheDocument()
    expect(free.getByTestId('public-price')).toHaveTextContent(pc.card.free)
  })

  it('badges the school subject (PORTAL-04) — never the difficulty, and never the curriculum levels', () => {
    renderCard({ subject: { id: 'sb', name: { ar: 'الرياضيات' } }, level: { id: 'lv', name: { ar: 'متقدم' } }, levelCount: 3 })
    expect(document.querySelector('.course-badge--subject')).toHaveTextContent('الرياضيات')
    expect(document.querySelector('.course-badge--level')).toBeNull()
    expect(document.querySelector('.public-card')).not.toHaveTextContent('متقدم')
    expect(document.querySelector('.public-card__facts')).toHaveTextContent('3 مستويات')
    expect(document.querySelector('.public-card__facts')).not.toHaveTextContent('الرياضيات')
  })

  it('shows no subject badge without course.subject, even with curriculum levels', () => {
    const card = renderCard({ subject: null, levelCount: 3 })
    expect(document.querySelector('.course-badge--subject')).toBeNull()
    expect(card.getByText('3 مستويات')).toBeInTheDocument()
  })

  it('shows the duration once, as a badge, and neither the code nor an empty summary', () => {
    const card = renderCard({ summary: null })
    expect(card.getAllByText('24 ساعة')).toHaveLength(1)
    expect(document.querySelector('.public-card__facts')).not.toHaveTextContent('24 ساعة')
    expect(card.queryByText('PY-101')).not.toBeInTheDocument()
    expect(document.querySelector('.public-card__summary')).toBeNull()
  })

  it('never shows the sessions (PORTAL-04), even when the server knows them', () => {
    const card = renderCard({ sessionsCount: 12 })
    expect(card.getByText('5 دروس')).toBeInTheDocument()
    expect(document.querySelector('.public-card')).not.toHaveTextContent('جلس')
    expect(document.querySelector('.public-card')).not.toHaveTextContent('12')
  })

  it('has one tab stop for the course: the name; «عرض الدورة» repeats it for the pointer only', () => {
    const card = renderCard({}, '/explore/x')
    const main = card.getByText(pc.card.viewCourse).closest('a')!
    expect(main).toHaveAttribute('href', '/explore/x')
    expect(main).toHaveAttribute('tabindex', '-1')
    expect(main).toHaveAttribute('aria-hidden', 'true')
    expect(card.getByRole('link', { name: 'أساسيات بايثون' })).toHaveAttribute('href', '/explore/x')
  })

  it('renders the same card on /home and on /explore', () => {
    const data = makePublicCard()
    const home = renderWithProviders(<HomeCourseCard card={data} href="/explore/x" />)
    const homeMarkup = screen.getByTestId(`public-card-${data.id}`).outerHTML
    home.unmount()
    renderWithProviders(<PublicCourseCard card={data} href="/explore/x" />)
    expect(screen.getByTestId(`public-card-${data.id}`).outerHTML).toBe(homeMarkup)
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

  it('is a plain preview without a link: no buttons at all', () => {
    const preview = renderCard({}, null)
    expect(preview.queryByRole('link')).not.toBeInTheDocument()
    expect(preview.queryByText(pc.card.viewCourse)).not.toBeInTheDocument()
    expect(preview.queryByText(pc.card.subscribeFree)).not.toBeInTheDocument()
    expect(document.querySelector('.public-card__foot')).toBeNull()
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
      expect(card.getByText(pc.card.viewCourse)).toBeInTheDocument()
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

  it('offers no subscribe action on the card, to anybody: subscribing starts on the course page', () => {
    const viewers = [
      makeAuth({ status: 'anonymous', user: null }),
      makeAuth({ user: makeUser({ role: 'student', roles: ['student'], permissions: [] }) }),
      makeAuth({ user: makeUser({ role: 'teacher', roles: ['teacher'], permissions: [] }) }),
    ]
    for (const auth of viewers) {
      for (const pricing of [{ pricing: 'free', price: null }, { pricing: 'paid', price: { amount: 150, currency: 'USD' } }] as const) {
        const data = makePublicCard({ hasFreeSeat: true, openClasses: 1, ...pricing })
        const { unmount } = renderWithProviders(<PublicCourseCard card={data} href={`/explore/${data.id}`} />, { auth })
        const card = within(screen.getByTestId(`public-card-${data.id}`))
        expect(screen.queryByTestId(`public-subscribe-${data.id}`)).not.toBeInTheDocument()
        expect(card.queryByText(pc.card.subscribeFree)).not.toBeInTheDocument()
        expect(card.queryByText(pc.card.subscribePaid)).not.toBeInTheDocument()
        expect(card.getByText(pc.card.viewCourse)).toBeInTheDocument()
        unmount()
      }
    }
  })
})
