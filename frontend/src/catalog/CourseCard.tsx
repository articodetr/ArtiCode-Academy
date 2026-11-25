// One course of «explore courses» (MOD-19, API-219), in the look of the public course card (the same classes and
// CardMedia; `public-card--app` carries the tokens inside the signed-in layout and keeps the app's font). What the
// server says of it: cover, name, summary, the badges (the school subject = `course.subject` since PORTAL-04, duration),
// the syllabus, the classes open with a seat, the lead teachers by name, the price, and the reader's own enrollment or
// pending request — no sessions since PORTAL-04. Both actions lead to the course page: «عرض الدورة» only opens it,
// while the enroll action carries the intent, so the page asks for the confirmation when one class takes the reader.
import { ReadOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { CatalogCourseCard } from '../api/catalog'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'
import { CardArrow } from '../publicCatalog/PublicCardActions'
import { CardMedia, Fact } from '../publicCatalog/PublicCourseCard'
import { courseBadgesOf } from '../publicCatalog/publicCatalog.view'
import '../publicCatalog/publicCatalog.css'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { cardAvailability } from './catalog.view'

function LabelledFact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <Fact icon={icon}>
      <span>{label}</span>
      <span className="public-card__fact-value">{children}</span>
    </Fact>
  )
}

export function CourseCard({ card, onOpen, onEnroll }: { card: CatalogCourseCard; onOpen: (courseId: string) => void; onEnroll: (courseId: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = cardAvailability(card)
  const name = localizedLabel(card.name, language)
  const offersEnroll = availability === 'available' && !card.mine.enrolled && !card.mine.pending
  const viewLabel = t('publicCatalog.card.viewCourse')
  const enrollLabel = t(card.pricing === 'paid' ? 'catalog.card.request' : 'catalog.card.enroll')
  const priceKind = card.pricing === 'free' ? 'free' : card.price ? 'amount' : 'unavailable'
  // The pill's colours: a course whose price is unavailable reads like a full one, in its own words.
  const availabilityTone = availability === 'priceUnavailable' ? 'full' : availability

  return (
    <article data-testid={`catalog-card-${card.id}`} className="public-card public-card--app public-card--link">
      <CardMedia id={card.id} url={card.coverImageUrl} badges={courseBadgesOf(card, t, language)} />
      <div className="public-card__body">
        <Typography.Title level={5} className="public-card__title">
          {/* As on the public card: the name is the real link, stretched over the card, and the card's tab stop. */}
          <Link to={`/catalog/${encodeURIComponent(card.id)}`} className="public-card__link" title={name}>
            {name}
          </Link>
        </Typography.Title>
        {card.summary ? (
          <Typography.Paragraph ellipsis={{ rows: 2 }} className="public-card__summary">
            {localizedLabel(card.summary, language)}
          </Typography.Paragraph>
        ) : null}
        <ul className="public-card__facts">
          <LabelledFact icon={<ReadOutlined />} label={t('catalog.card.syllabus')}>
            <bdi dir="ltr">{card.syllabusCount}</bdi>
          </LabelledFact>
          <LabelledFact icon={<TeamOutlined />} label={t('catalog.card.availableClasses')}>
            <bdi dir="ltr">{card.availableClasses}</bdi>
          </LabelledFact>
          {card.teachers.length > 0 ? (
            <LabelledFact icon={<UserOutlined />} label={t('catalog.card.teachers')}>
              {card.teachers.map(displayNameOf).join('، ')}
            </LabelledFact>
          ) : null}
        </ul>
        {card.mine.enrolled || card.mine.pending ? (
          <div className="public-card__mine">
            {card.mine.enrolled ? <span className="public-card__availability public-card__availability--available">{t('catalog.card.enrolled')}</span> : null}
            {card.mine.pending ? <span className="public-card__availability public-card__availability--full">{t('catalog.card.pending')}</span> : null}
          </div>
        ) : null}
        <div className="public-card__status">
          <span className={`public-price public-price--${priceKind}`}>
            {card.pricing === 'free' ? t('catalog.free') : card.price ? <bdi dir="ltr">{formatMoney(card.price.amount, card.price.currency, language)}</bdi> : t('catalog.paid')}
          </span>
          <span className={`public-card__availability public-card__availability--${availabilityTone}`}>
            <span className="public-card__dot" aria-hidden="true" />
            {t(`catalog.card.${availability}`)}
          </span>
        </div>
      </div>
      <div className="public-card__foot">
        <div className="public-card__subscribe-line">
          {offersEnroll ? (
            <button type="button" className="public-card__subscribe" aria-label={`${enrollLabel}: ${name}`} onClick={() => onEnroll(card.id)}>
              {enrollLabel}
            </button>
          ) : null}
        </div>
        {/* The same destination as the name's link, for the pointer: out of the tab order and the accessibility tree. */}
        <button type="button" className="public-card__action" tabIndex={-1} aria-hidden="true" onClick={() => onOpen(card.id)}>
          {viewLabel}
          <CardArrow />
        </button>
      </div>
    </article>
  )
}
