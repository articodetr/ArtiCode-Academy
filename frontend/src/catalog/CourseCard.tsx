// One course of «explore courses» (MOD-19, API-219): what the server says of
// it — cover, name, summary, level, duration, sessions, price, the classes
// open to self-service and how many have a seat, the lead teachers by name,
// and the reader's own enrollment or pending request. Both buttons lead to the
// course page: «التفاصيل» only opens it, while the enroll button carries the
// intent, so the page asks for the confirmation when one class takes the reader.
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CatalogCourseCard } from '../api/catalog'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { AVAILABILITY_COLORS, cardAvailability, coverSrc } from './catalog.view'
import { CourseCover } from './CourseCover'

export function CourseCard({ card, onOpen, onEnroll }: { card: CatalogCourseCard; onOpen: (courseId: string) => void; onEnroll: (courseId: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = cardAvailability(card)
  const cover = coverSrc(card.coverImageUrl)
  const name = localizedLabel(card.name, language)
  const offersEnroll = availability === 'available' && !card.mine.enrolled && !card.mine.pending

  const facts: DescriptionsProps['items'] = []
  if (card.durationHours !== null) facts.push({ key: 'duration', label: t('catalog.card.duration'), children: <bdi dir="ltr">{card.durationHours}</bdi> })
  if (card.sessionsCount !== null) facts.push({ key: 'sessions', label: t('catalog.card.sessions'), children: <bdi dir="ltr">{card.sessionsCount}</bdi> })
  facts.push({ key: 'syllabus', label: t('catalog.card.syllabus'), children: <bdi dir="ltr">{card.syllabusCount}</bdi> })
  facts.push({ key: 'classes', label: t('catalog.card.availableClasses'), children: <bdi dir="ltr">{card.availableClasses}</bdi> })
  if (card.teachers.length > 0) facts.push({ key: 'teachers', label: t('catalog.card.teachers'), children: card.teachers.map(displayNameOf).join('، ') })

  return (
    <Card
      data-testid={`catalog-card-${card.id}`}
      style={{ height: '100%' }}
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      cover={cover ? <CourseCover key={cover} url={card.coverImageUrl} /> : undefined}
      actions={[
        <Button key="details" type="link" onClick={() => onOpen(card.id)}>
          {t('catalog.card.details')}
        </Button>,
        ...(offersEnroll
          ? [
              <Button key="enroll" type="primary" onClick={() => onEnroll(card.id)}>
                {t(card.pricing === 'paid' ? 'catalog.card.request' : 'catalog.card.enroll')}
              </Button>,
            ]
          : []),
      ]}
    >
      <div>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {name}
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
        {card.pricing === 'free' ? (
          <Tag color="green">{t('catalog.free')}</Tag>
        ) : card.price ? (
          <Tag color="gold">
            <bdi dir="ltr">{formatMoney(card.price.amount, card.price.currency, language)}</bdi>
          </Tag>
        ) : (
          <Tag color="gold">{t('catalog.paid')}</Tag>
        )}
        <Tag color={AVAILABILITY_COLORS[availability]}>{t(`catalog.card.${availability}`)}</Tag>
        {card.mine.enrolled ? <Tag color="green">{t('catalog.card.enrolled')}</Tag> : null}
        {card.mine.pending ? <Tag color="gold">{t('catalog.card.pending')}</Tag> : null}
      </Space>
      <Descriptions size="small" column={1} items={facts} />
    </Card>
  )
}
