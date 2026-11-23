// PORTAL-04 PR-1 redesign: the public course card's media box (a cover, or a plain placeholder — also when the cover
// fails), the level badge on it, and the price at its foot. The link behaviour is covered by the catalog and home pages.
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ar } from '../i18n/ar'
import { makePublicCard } from '../test/publicCatalog'
import { renderWithProviders } from '../test/render'
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
})
