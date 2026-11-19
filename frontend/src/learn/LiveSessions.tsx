// A live lesson (MOD-20 — D-R134): the class sessions that cover it (API-231
// `sessions` — the learner's own classes only), each on the wall clock of its
// own zone (D-R41, named when it is not this device's), its status, the
// meeting link of a session that is not cancelled, and the learner's own
// attendance; then the author's note. Nothing is joined or recorded here.
import { VideoCameraOutlined } from '@ant-design/icons'
import { Button, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { LessonSession } from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import { differsFromDevice } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { localizedLabel } from '../users/users.format'
import { isHttpsUrl } from './learn.format'
import { PlainText } from './PlainText'

const STATUS_COLORS: Readonly<Record<string, string>> = { scheduled: 'blue', completed: 'green', cancelled: 'default' }
const KNOWN_STATUSES = new Set(['scheduled', 'completed', 'cancelled'])
const KNOWN_ATTENDANCE = new Set(['present', 'late', 'absent', 'excused'])

export function LiveSessions({ sessions, note }: { sessions: readonly LessonSession[]; note: LocalizedLabel | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const noteText = note ? localizedLabel(note, language) : ''
  return (
    <div className="learn-live">
      <h3 className="learn-subheading">{t('learn.live.sessions')}</h3>
      {sessions.length === 0 ? <p className="learn-muted">{t('learn.live.noSessions')}</p> : null}
      {sessions.length > 0 ? (
        <ul className="learn-list">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      ) : null}
      {noteText.trim() ? (
        <div className="learn-live__note">
          <h3 className="learn-subheading">{t('learn.live.note')}</h3>
          <PlainText text={noteText} />
        </div>
      ) : null}
    </div>
  )
}

function SessionRow({ session }: { session: LessonSession }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const zone = session.timeZone
  const cancelled = session.status === 'cancelled'
  const attendance = session.attendance
  let attendanceText = t('learn.live.noAttendance')
  if (attendance && KNOWN_ATTENDANCE.has(attendance.status)) {
    attendanceText =
      attendance.status === 'late' && typeof attendance.minutesLate === 'number'
        ? t('learn.live.lateBy', { minutes: attendance.minutesLate })
        : t(`learn.live.attendance.${attendance.status}`)
  }
  return (
    <li className="learn-list__row learn-session">
      <div className="learn-session__main">
        <strong className="learn-session__title">{localizedLabel(session.title, language)}</strong>
        <span className="learn-muted">
          {formatLessonDay(session.startsAt, language, zone)} · <bdi dir="ltr">{formatLessonTimes(session.startsAt, session.endsAt, language, zone)}</bdi>
          {differsFromDevice(zone) ? (
            <>
              {' '}
              ({t('learn.live.zone', { zone })})
            </>
          ) : null}
        </span>
        {cancelled ? null : <span className="learn-session__attendance">{attendanceText}</span>}
      </div>
      <div className="learn-session__side">
        {KNOWN_STATUSES.has(session.status) ? (
          <Tag color={STATUS_COLORS[session.status]} bordered={false}>
            {t(`learn.live.status.${session.status}`)}
          </Tag>
        ) : null}
        {!cancelled && session.meetingUrl && isHttpsUrl(session.meetingUrl) ? (
          <Button size="small" icon={<VideoCameraOutlined aria-hidden />} href={session.meetingUrl} target="_blank" rel="noopener noreferrer">
            {t('learn.live.join')}
            <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
          </Button>
        ) : null}
      </div>
    </li>
  )
}
