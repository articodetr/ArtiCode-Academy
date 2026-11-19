// One course of the public catalog (API-236): cover, name, summary, level,
// price («مجانية», the amount in its currency, or «السعر غير متاح حالياً»), duration, sessions, the
// lesson and level counts and whether a class is open now — the server's
// numbers only, never a teacher or a schedule (D-R138). «التفاصيل» opens the
// course page.
import { ApartmentOutlined, CalendarOutlined, ClockCircleOutlined, ReadOutlined } from '@ant-design/icons'
import { Button, Card, Flex, Space, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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

export function PublicCourseCard({ card, onOpen }: { card: PublicCourseCardData; onOpen: (courseId: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const availability = availabilityOf(card)
  const cover = coverSrc(card.coverImageUrl)

  return (
    <Card
      data-testid={`public-card-${card.id}`}
      style={{ height: '100%' }}
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      cover={cover ? <CourseCover key={cover} url={card.coverImageUrl} /> : undefined}
      actions={[
        <Button key="details" type="link" onClick={() => onOpen(card.id)}>
          {t('publicCatalog.list.details')}
        </Button>,
      ]}
    >
      <div>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {localizedLabel(card.name, language)}
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
        <Tag color={AVAILABILITY_COLORS[availability]}>{t(`publicCatalog.card.${availability}`)}</Tag>
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
