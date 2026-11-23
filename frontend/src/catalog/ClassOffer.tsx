// One class of a catalog course (MOD-19, API-220): dates, lead teacher, seats,
// weekly times (each in its own zone, named when it is not this device's),
// the reader's own enrollment or request, why it takes nobody now (the
// server's `blocker`), and the enroll button when the server says it would
// accept the reader (`enrollable`).
import { Button, Card, Descriptions, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CatalogClass } from '../api/catalog'
import type { CoursePricing } from '../api/courses'
import { SeatsBar } from '../classes/SeatsBar'
import { differsFromDevice } from '../common/timeZone'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDay, localizedLabel } from '../users/users.format'
import { REQUEST_STATE_COLORS, weekdayKey } from './catalog.view'

interface ClassOfferProps {
  klass: CatalogClass
  pricing: CoursePricing
  /** The reader may enroll themself (the server's `selfService.allowed`). */
  canEnroll: boolean
  /** The only class that takes the reader now: shown as the obvious choice. */
  recommended: boolean
  busy: boolean
  /** Another class is being enrolled in: no second request at the same time. */
  disabled: boolean
  onEnroll: (klass: CatalogClass) => void
}

const DASH = '—'

export function ClassOffer({ klass, pricing, canEnroll, recommended, busy, disabled, onEnroll }: ClassOfferProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const name = localizedLabel(klass.name, language)

  const items: DescriptionsProps['items'] = [
    { key: 'status', label: t('catalog.class.status'), children: <StatusTag value={klass.status} /> },
    {
      key: 'period',
      label: t('catalog.class.period'),
      children: klass.startsOn || klass.endsOn ? `${formatDay(klass.startsOn, language)} – ${formatDay(klass.endsOn, language)}` : DASH,
    },
    {
      key: 'teacher',
      label: t('catalog.class.teacher'),
      children: klass.leadTeacher ? displayNameOf(klass.leadTeacher) : <Typography.Text type="secondary">{t('catalog.class.noTeacher')}</Typography.Text>,
    },
    { key: 'seats', label: t('catalog.class.seats'), children: <SeatsBar cls={klass} /> },
    { key: 'seatsLeft', label: t('catalog.class.seatsLeft'), children: <bdi dir="ltr">{klass.seatsLeft}</bdi> },
  ]

  return (
    <Card
      size="small"
      data-testid={`catalog-class-${klass.id}`}
      title={
        <Space size={6} wrap>
          <span>{name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{klass.code}</bdi>
          </Typography.Text>
        </Space>
      }
      extra={recommended ? <Tag color="green">{t('catalog.class.recommended')}</Tag> : null}
      styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
    >
      <Descriptions size="small" column={1} items={items} />

      <div>
        <Typography.Text strong>{t('catalog.class.schedule')}</Typography.Text>
        {klass.schedule.length === 0 ? (
          <div>
            <Typography.Text type="secondary">{t('catalog.class.noSchedule')}</Typography.Text>
          </div>
        ) : (
          <ul style={{ margin: '4px 0', paddingInlineStart: 20 }}>
            {klass.schedule.map((slot, index) => (
              <li key={`${slot.weekday}-${slot.startTime}-${index}`}>
                <Space size={6} wrap>
                  <span>{t(`days.${weekdayKey(slot.weekday)}`)}</span>
                  <bdi dir="ltr">{`${slot.startTime}–${slot.endTime}`}</bdi>
                  {differsFromDevice(slot.timeZone) ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('catalog.class.inZone', { zone: slot.timeZone })}
                    </Typography.Text>
                  ) : null}
                  {slot.effectiveTo ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('catalog.class.until', { day: formatDay(slot.effectiveTo, language) })}
                    </Typography.Text>
                  ) : null}
                </Space>
              </li>
            ))}
          </ul>
        )}
        {klass.schedule.length > 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('catalog.class.scheduleNote')}
          </Typography.Text>
        ) : null}
      </div>

      {klass.myEnrollment ? (
        <Space size={6} wrap>
          <Typography.Text>{t('catalog.class.myState')}</Typography.Text>
          <Tag color={REQUEST_STATE_COLORS[klass.myEnrollment.state]}>{t(`catalog.states.${klass.myEnrollment.state}`)}</Tag>
        </Space>
      ) : klass.blocker && klass.blocker !== 'not_allowed' ? (
        <Typography.Text type="secondary">{t(`catalog.blockers.${klass.blocker}`)}</Typography.Text>
      ) : null}

      {canEnroll && klass.enrollable ? (
        <Button type={recommended ? 'primary' : 'default'} loading={busy} disabled={disabled && !busy} onClick={() => onEnroll(klass)} block>
          {t(pricing === 'paid' ? 'catalog.class.request' : 'catalog.class.enroll')}
        </Button>
      ) : null}
    </Card>
  )
}
