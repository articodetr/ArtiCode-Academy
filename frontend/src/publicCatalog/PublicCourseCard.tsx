// One course of the public catalog (API-236): cover, name, summary, level,
// price («مجانية», the amount in its currency, or «السعر غير متاح حالياً»), duration, sessions, the
// lesson and level counts and whether a class is open now — the server's
// numbers only, never a teacher or a schedule (D-R138). The whole card opens the
// course page (PORTAL-04 PR-2): the name is a real link (`href` — a new tab, the
// keyboard, a copied address all work) stretched over the card, which is the
// card's only tab stop; «التفاصيل» is the same link for the pointer, kept out of
// the tab order and of the accessibility tree so nothing is announced twice.
// Without `href` (a viewer who may open no course page — PORTAL-04 review) the
// card is a plain preview: no link and no «التفاصيل». The name is a heading one
// level under the place the card sits in (`headingLevel`): h2 under the /explore
// h1, h3 (the default) under a /home section h2.
//
// The look (PORTAL-04 PR-1 redesign): a 16:9 media box on top — the course's
// cover, or a plain patterned placeholder with a book icon when it has none or
// the image fails (never a picture that could pass for the course's own), with
// the level as a badge on it — then the name, the code, two lines of summary, the
// facts in one wrapping row, whether a class is open, and a foot with the price, the
// subscribe button when the course takes an enrollment (PublicCardActions) and
// «التفاصيل». The body grows, so the feet of a row line up.
import { ApartmentOutlined, CalendarOutlined, ClockCircleOutlined, ReadOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PublicCourseCard as PublicCourseCardData } from '../api/publicCatalog'
import { coverSrc } from '../catalog/catalog.view'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { PublicCardActions } from './PublicCardActions'
import { PublicPriceText } from './PublicPriceTag'
import { availabilityOf, placeholderTintOf } from './publicCatalog.view'

export function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="public-card__fact">
      <span className="public-card__fact-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </li>
  )
}

/** The cover (decorative, `alt=""`) over the placeholder: a cover that fails to load leaves the placeholder showing. */
export function CardMedia({ id, url, badge }: { id: string; url: string | null; badge: string | null }) {
  const [broken, setBroken] = useState<string | null>(null)
  const src = coverSrc(url)
  return (
    <div className="public-card__media">
      <div className={`public-card__placeholder public-card__placeholder--t${placeholderTintOf(id)}`} aria-hidden="true">
        <ReadOutlined className="public-card__placeholder-icon" />
      </div>
      {src && src !== broken ? (
        <img
          className="public-card__cover"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(src)}
          data-testid="course-cover"
        />
      ) : null}
      {badge ? <span className="public-card__badge">{badge}</span> : null}
    </div>
  )
}

export function PublicCourseCard({ card, href, headingLevel = 3 }: { card: PublicCourseCardData; href: string | null; headingLevel?: 2 | 3 }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = availabilityOf(card)
  const name = localizedLabel(card.name, language)

  return (
    <article data-testid={`public-card-${card.id}`} className={href !== null ? 'public-card public-card--link' : 'public-card'}>
      <CardMedia id={card.id} url={card.coverImageUrl} badge={card.level ? localizedLabel(card.level.name, language) : null} />
      <div className="public-card__body">
        <div>
          <Typography.Title level={headingLevel} className="public-card__title">
            {href !== null ? (
              <Link to={href} className="public-card__link">
                {name}
              </Link>
            ) : (
              name
            )}
          </Typography.Title>
          <div className="public-card__code">
            <bdi dir="ltr">{card.code}</bdi>
          </div>
        </div>
        {card.summary ? (
          <Typography.Paragraph ellipsis={{ rows: 2 }} className="public-card__summary">
            {localizedLabel(card.summary, language)}
          </Typography.Paragraph>
        ) : null}
        <ul className="public-card__facts">
          {card.durationHours !== null ? <Fact icon={<ClockCircleOutlined />}>{t('publicCatalog.card.hours', { count: card.durationHours })}</Fact> : null}
          {card.sessionsCount !== null ? <Fact icon={<CalendarOutlined />}>{t('publicCatalog.card.sessionsCount', { count: card.sessionsCount })}</Fact> : null}
          <Fact icon={<ReadOutlined />}>{t('publicCatalog.card.lessons', { count: card.lessonCount })}</Fact>
          {card.levelCount > 0 ? <Fact icon={<ApartmentOutlined />}>{t('publicCatalog.card.levels', { count: card.levelCount })}</Fact> : null}
        </ul>
        {/* A paid course without a usable price: the price already says why nobody can enroll. */}
        {availability !== 'priceUnavailable' ? (
          <div className={`public-card__availability public-card__availability--${availability}`}>
            <span className="public-card__dot" aria-hidden="true" />
            {t(`publicCatalog.card.${availability}`)}
          </div>
        ) : null}
      </div>
      <div className="public-card__foot">
        <PublicPriceText course={card} />
        <PublicCardActions card={card} name={name} href={href} />
      </div>
    </article>
  )
}
