// One program on the public home page, in the page's own card: the picture (the
// course's cover, or the plain placeholder — never a stock photo that could pass
// for it), the name, whether a class is open with the price beside it, the facts
// and the subscribe and details buttons (PublicCardActions). The server's data only: API-236 names no teacher
// (D-R138) and holds no rating, so the card shows neither. As on /explore, the
// name is the one link to the course page, stretched over the card. Without `href`
// (a viewer who may open no course page) the card is a plain preview.
import { CalendarOutlined, ClockCircleOutlined, ReadOutlined } from '@ant-design/icons'
import { Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PublicCourseCard } from '../api/publicCatalog'
import { useLocalized } from '../i18n/useLocalized'
import { PublicCardActions } from '../publicCatalog/PublicCardActions'
import { CardMedia, Fact } from '../publicCatalog/PublicCourseCard'
import { PublicPriceText } from '../publicCatalog/PublicPriceTag'
import { availabilityOf } from '../publicCatalog/publicCatalog.view'
import { localizedLabel } from '../users/users.format'

export function HomeCourseCard({ card, href }: { card: PublicCourseCard; href: string | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = availabilityOf(card)
  const name = localizedLabel(card.name, language)

  return (
    <article data-testid={`public-card-${card.id}`} className={href !== null ? 'public-card public-card--home public-card--link' : 'public-card public-card--home'}>
      <CardMedia id={card.id} url={card.coverImageUrl} badge={card.level ? localizedLabel(card.level.name, language) : null} />
      <div className="public-card__body">
        <Typography.Title level={3} className="public-card__title">
          {href !== null ? (
            <Link to={href} className="public-card__link">
              {name}
            </Link>
          ) : (
            name
          )}
        </Typography.Title>
        <div className="public-card__row">
          {/* A paid course without a usable price: the price already says why nobody can enroll. */}
          {availability !== 'priceUnavailable' ? (
            <span className={`public-card__availability public-card__availability--${availability}`}>
              <span className="public-card__dot" aria-hidden="true" />
              {t(`publicCatalog.card.${availability}`)}
            </span>
          ) : (
            <span />
          )}
          <PublicPriceText course={card} />
        </div>
        <ul className="public-card__facts">
          {card.durationHours !== null ? <Fact icon={<ClockCircleOutlined />}>{t('publicCatalog.card.hours', { count: card.durationHours })}</Fact> : null}
          {card.sessionsCount !== null ? <Fact icon={<CalendarOutlined />}>{t('publicCatalog.card.sessionsCount', { count: card.sessionsCount })}</Fact> : null}
          <Fact icon={<ReadOutlined />}>{t('publicCatalog.card.lessons', { count: card.lessonCount })}</Fact>
        </ul>
      </div>
      <PublicCardActions card={card} name={name} href={href} />
    </article>
  )
}
