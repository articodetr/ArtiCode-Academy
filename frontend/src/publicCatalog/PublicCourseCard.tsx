// One course of the public catalog (API-236), on /explore and /home alike (HomeCourseCard is this card): the
// server's values only, never a teacher or a schedule (D-R138). The whole card opens the course page (PORTAL-04 PR-2):
// the name is a real link (`href` — a new tab, the keyboard, a copied address all work) stretched over the card, which
// is the card's tab stop; «عرض الدورة» is the same link for the pointer, kept out of the tab order and of the
// accessibility tree so nothing is announced twice. Without `href` (a viewer who may open no course page — PORTAL-04
// review) the card is a plain preview: no link and no buttons. The name is a heading one level under the place the card
// sits in (`headingLevel`): h2 under the /explore h1, h3 (the default) under a /home section h2.
//
// The look (the course redesign): a 16:9 picture flush with the card's edges — the course's cover, or a plain patterned
// placeholder with a book icon when it has none or the image fails (never a picture that could pass for the course's
// own) — with the small badges on it (type, difficulty = `course.level`, duration); then the name, two lines of summary
// when there is one, the facts (lessons, curriculum levels, sessions — the duration is already a badge), the price with
// the availability, and the actions (PublicCardActions). The course code is not shown; a search by code still works, on
// the server. The body grows, so the feet of a row line up.
import { ApartmentOutlined, CalendarOutlined, ReadOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PublicCourseCard as PublicCourseCardData } from '../api/publicCatalog'
import { coverSrc } from '../catalog/catalog.view'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { CourseBadges } from './CourseBadges'
import { PublicCardActions } from './PublicCardActions'
import { PublicPriceText } from './PublicPriceTag'
import { availabilityOf, availabilityPillKey, courseBadgesOf, placeholderTintOf } from './publicCatalog.view'
import type { CourseBadge } from './publicCatalog.view'

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
export function CardMedia({ id, url, badges }: { id: string; url: string | null; badges?: readonly CourseBadge[] }) {
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
      {badges ? <CourseBadges badges={badges} className="course-badges--media" /> : null}
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
      <CardMedia id={card.id} url={card.coverImageUrl} badges={courseBadgesOf(card, t, language)} />
      <div className="public-card__body">
        <Typography.Title level={headingLevel} className="public-card__title">
          {href !== null ? (
            <Link to={href} className="public-card__link" title={name}>
              {name}
            </Link>
          ) : (
            name
          )}
        </Typography.Title>
        {card.summary ? (
          <Typography.Paragraph ellipsis={{ rows: 2 }} className="public-card__summary">
            {localizedLabel(card.summary, language)}
          </Typography.Paragraph>
        ) : null}
        <ul className="public-card__facts">
          <Fact icon={<ReadOutlined />}>{t('publicCatalog.card.lessons', { count: card.lessonCount })}</Fact>
          {card.levelCount > 0 ? <Fact icon={<ApartmentOutlined />}>{t('publicCatalog.card.levels', { count: card.levelCount })}</Fact> : null}
          {card.sessionsCount !== null ? <Fact icon={<CalendarOutlined />}>{t('publicCatalog.card.sessionsCount', { count: card.sessionsCount })}</Fact> : null}
        </ul>
        <div className="public-card__status">
          <PublicPriceText course={card} />
          {/* A paid course without a usable price: the price already says why nobody can enroll. */}
          {availability !== 'priceUnavailable' ? (
            <span className={`public-card__availability public-card__availability--${availability}`}>
              <span className="public-card__dot" aria-hidden="true" />
              {t(availabilityPillKey(availability))}
            </span>
          ) : null}
        </div>
      </div>
      <PublicCardActions href={href} />
    </article>
  )
}
