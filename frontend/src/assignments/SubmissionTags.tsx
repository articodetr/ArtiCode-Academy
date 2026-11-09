// Small pieces of the submissions screens (J-F41): the state of an attempt
// (or «not submitted»), the server's «late» mark, and an instant in the
// assignment's own zone (D-R41) with the zone named when it is not this
// device's — the J-F38 helpers of assignments.format.ts / assignments.zone.ts.
import { Space, Tag, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { formatZonedDateTime } from './assignments.format'
import { differsFromDevice } from './assignments.zone'
import type { RosterState } from './submissions.roster'

const STATE_COLORS: Readonly<Record<RosterState, string>> = { submitted: 'gold', graded: 'green', returned: 'orange', none: 'default' }

/** The state of a student's latest attempt, or «not submitted». */
export function SubmissionStatusTag({ status }: { status: RosterState }) {
  const { t } = useTranslation()
  return <Tag color={STATE_COLORS[status]}>{t(`assignments.submissionStatus.${status}`)}</Tag>
}

/** The server's `isLate`: submitted after the due date under allowLate (never this device's clock). */
export function LateTag() {
  const { t } = useTranslation()
  return <Tag color="volcano">{t('assignments.roster.late')}</Tag>
}

/** An instant in `zone`; the zone is named after it when it is not this device's (`showZone` false: a heading names it once). */
export function ZonedTime({ iso, zone, showZone = true }: { iso: string; zone: string; showZone?: boolean }) {
  const { language } = useLocalized()
  return (
    <Space wrap size={4}>
      <span>{formatZonedDateTime(iso, zone, language)}</span>
      {showZone && differsFromDevice(zone) ? (
        <Typography.Text type="secondary">
          (<span dir="ltr">{zone}</span>)
        </Typography.Text>
      ) : null}
    </Space>
  )
}
