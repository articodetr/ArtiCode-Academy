// The time-zone pieces of the lessons screens (D-R41 — J-F28), shared by
// /lessons and «my lessons»: the «when» cell of a row (the day and the times in
// the lesson's own zone, and the zone's name when it is not this device's),
// the page note that says which zones the page uses — shown only when one of
// them differs from the device's, so a user in the academy's zone sees no extra
// text — and the zone of the lesson drawer with this device's zone beside it.
// A time range sits in a plain `dir="ltr"` span: antd Typography's RTL class
// would override the attribute and reverse `10:00 – 11:30`.
import { Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { useLocalized } from '../i18n/useLocalized'
import { deviceTimeZone } from '../timetable/timetable.settings'
import { differsFromDevice, formatLessonDay, formatLessonTimes } from './lessons.format'

interface LessonWhenProps {
  startsAt: string
  endsAt: string
  /** The lesson's `timeZone` (D-R41). */
  timeZone: string
}

/** The «when» cell of a lessons table: day, times, and the zone when it differs from this device's. */
export function LessonWhen({ startsAt, endsAt, timeZone }: LessonWhenProps) {
  const { language } = useLocalized()
  return (
    <span>
      <Typography.Text>{formatLessonDay(startsAt, language, timeZone)}</Typography.Text>
      <br />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        <span dir="ltr">{formatLessonTimes(startsAt, endsAt, language, timeZone)}</span>
      </Typography.Text>
      {differsFromDevice(timeZone) ? (
        <>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <span dir="ltr" data-testid="lesson-row-zone">
              {timeZone}
            </span>
          </Typography.Text>
        </>
      ) : null}
    </span>
  )
}

interface LessonZoneNoteProps {
  /** The zones of the rows on screen. */
  timeZones: readonly string[]
  /** The zone of «today» and the filter days (the academy's — useAcademyZone()). */
  dayZone: string
}

/** One note per page: the rows' zones and the days' zone, each said only when it differs from this device's. */
export function LessonZoneNote({ timeZones, dayZone }: LessonZoneNoteProps) {
  const { t } = useTranslation()
  const device = deviceTimeZone()
  const sentences: string[] = []
  if (timeZones.some((zone) => differsFromDevice(zone, device))) sentences.push(t('lessons.zone.rows', { zone: device }))
  if (differsFromDevice(dayZone, device)) sentences.push(t('lessons.zone.days', { zone: dayZone }))
  if (sentences.length === 0) return null
  return (
    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }} data-testid="lesson-zone-note">
      {sentences.join(' ')}
    </Typography.Paragraph>
  )
}

/** The lesson's zone (drawer), with this device's beside it when they differ. */
export function LessonZoneValue({ timeZone }: { timeZone: string }) {
  const { t } = useTranslation()
  const device = deviceTimeZone()
  return (
    <span>
      <span dir="ltr">{timeZone}</span>
      {differsFromDevice(timeZone, device) ? <Typography.Text type="secondary">{` (${t('lessons.zone.device', { zone: device })})`}</Typography.Text> : null}
    </span>
  )
}
