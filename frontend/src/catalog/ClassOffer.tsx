// One class of a catalog course (MOD-19, API-220): dates, lead teacher, seats,
// weekly times (each in its own zone, named when it is not this device's),
// the reader's own enrollment or request, why it takes nobody now (the
// server's `blocker`), and the enroll button when the server says it would
// accept the reader (`enrollable`). Its look (rows, schedule, footer) is
// `.class-offer` in catalogCourse.css, on the course page only.
import { Button, Card, Descriptions, Tag, Typography } from 'antd'
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
      className="class-offer"
      data-testid={`catalog-class-${klass.id}`}
      title={
        <span className="class-offer__title">
          <span className="class-offer__name">{name}</span>
          <bdi dir="ltr" className="class-offer__code">
            {klass.code}
          </bdi>
        </span>
      }
      extra={recommended ? <Tag color="green">{t('catalog.class.recommended')}</Tag> : null}
    >
      <Descriptions className="class-offer__facts" size="small" column={1} colon={false} items={items} />

      <div className="class-offer__schedule">
        <span className="class-offer__heading">{t('catalog.class.schedule')}</span>
        {klass.schedule.length === 0 ? (
          <span className="class-offer__muted">{t('catalog.class.noSchedule')}</span>
        ) : (
          <ul className="class-offer__slots">
            {klass.schedule.map((slot, index) => (
              <li key={`${slot.weekday}-${slot.startTime}-${index}`} className="class-offer__slot">
                <span className="class-offer__day">{t(`days.${weekdayKey(slot.weekday)}`)}</span>
                <bdi dir="ltr">{`${slot.startTime}–${slot.endTime}`}</bdi>
                {differsFromDevice(slot.timeZone) ? <span className="class-offer__note">{t('catalog.class.inZone', { zone: slot.timeZone })}</span> : null}
                {slot.effectiveTo ? <span className="class-offer__note">{t('catalog.class.until', { day: formatDay(slot.effectiveTo, language) })}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {klass.schedule.length > 0 ? <span className="class-offer__note">{t('catalog.class.scheduleNote')}</span> : null}
      </div>

      {klass.myEnrollment ? (
        <div className="class-offer__mine">
          <span>{t('catalog.class.myState')}</span>
          <Tag color={REQUEST_STATE_COLORS[klass.myEnrollment.state]}>{t(`catalog.states.${klass.myEnrollment.state}`)}</Tag>
        </div>
      ) : klass.blocker && klass.blocker !== 'not_allowed' ? (
        <span className="class-offer__blocker">{t(`catalog.blockers.${klass.blocker}`)}</span>
      ) : null}

      {canEnroll && klass.enrollable ? (
        <Button className="class-offer__enroll" type={recommended ? 'primary' : 'default'} loading={busy} disabled={disabled && !busy} onClick={() => onEnroll(klass)} block>
          {t(pricing === 'paid' ? 'catalog.class.request' : 'catalog.class.enroll')}
        </Button>
      ) : null}
    </Card>
  )
}
