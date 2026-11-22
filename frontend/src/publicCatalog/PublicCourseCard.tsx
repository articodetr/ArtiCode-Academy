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
import { ApartmentOutlined, CalendarOutlined, ClockCircleOutlined, ReadOutlined } from '@ant-design/icons'
import { Card, Flex, Space, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PublicCourseCard as PublicCourseCardData } from '../api/publicCatalog'
import { coverSrc } from '../catalog/catalog.view'
import { CourseCover } from '../catalog/CourseCover'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { PublicPriceTag } from './PublicPriceTag'
import { AVAILABILITY_COLORS, availabilityOf } from './publicCatalog.view'

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
      {icon} {children}
    </Typography.Text>
  )
}

export function PublicCourseCard({ card, href, headingLevel = 3 }: { card: PublicCourseCardData; href: string | null; headingLevel?: 2 | 3 }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = availabilityOf(card)
  const cover = coverSrc(card.coverImageUrl)
  const name = localizedLabel(card.name, language)

  return (
    <Card
      data-testid={`public-card-${card.id}`}
      className="public-card"
      hoverable={href !== null}
      style={{ height: '100%' }}
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12, flex: 1 } }}
      cover={cover ? <CourseCover key={cover} url={card.coverImageUrl} /> : undefined}
      actions={
        href !== null
          ? [
              <Link key="details" to={href} className="public-card__action" tabIndex={-1} aria-hidden="true">
                {t('publicCatalog.list.details')}
              </Link>,
            ]
          : undefined
      }
    >
      <div>
        <Typography.Title level={headingLevel} style={{ margin: 0, fontSize: 16 }}>
          {href !== null ? (
            <Link to={href} className="public-card__link">
              {name}
            </Link>
          ) : (
            name
          )}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <bdi dir="ltr">{card.code}</bdi>
        </Typography.Text>
      </div>
      {card.summary ? (
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} style={{ margin: 0 }}>
          {localizedLabel(card.summary, language)}
        </Typography.Paragraph>
      ) : null}
      <Space size={[4, 4]} wrap>
        {card.level ? <Tag color="blue">{localizedLabel(card.level.name, language)}</Tag> : null}
        <PublicPriceTag course={card} />
        {/* A paid course without a usable price: the price tag already says why nobody can enroll. */}
        {availability !== 'priceUnavailable' ? <Tag color={AVAILABILITY_COLORS[availability]}>{t(`publicCatalog.card.${availability}`)}</Tag> : null}
      </Space>
      <Flex vertical gap={4}>
        {card.durationHours !== null ? <Fact icon={<ClockCircleOutlined />}>{t('publicCatalog.card.hours', { count: card.durationHours })}</Fact> : null}
        {card.sessionsCount !== null ? <Fact icon={<CalendarOutlined />}>{t('publicCatalog.card.sessionsCount', { count: card.sessionsCount })}</Fact> : null}
        <Fact icon={<ReadOutlined />}>{t('publicCatalog.card.lessons', { count: card.lessonCount })}</Fact>
        {card.levelCount > 0 ? <Fact icon={<ApartmentOutlined />}>{t('publicCatalog.card.levels', { count: card.levelCount })}</Fact> : null}
      </Flex>
    </Card>
  )
}
