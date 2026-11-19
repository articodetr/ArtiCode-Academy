// «حصص الفصل» in the course player's sidebar (MOD-20 — D-R143): every class
// session of the learner's class (API-230 `sessions` — MOD-06 lessons a
// manager added or generated), those still ahead first (the soonest first),
// then the past ones behind their own toggle (the most recent first). Each
// session on the wall clock of its own zone (D-R41 — named when it is not
// this device's), its status, the learner's own attendance, the meeting link
// of one that is not cancelled, and — when it covers a curriculum lesson the
// learner can open — the way to that lesson. Nothing is joined or recorded here.
import { BookOutlined, CalendarOutlined, DownOutlined, LockOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Button, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { WorkspaceSession } from '../api/learning'
import type { LocalizedLabel } from '../api/users'
import { differsFromDevice } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { formatLessonDay, formatLessonTimes } from '../lessons/lessons.format'
import { localizedLabel } from '../users/users.format'
import { isHttpsUrl } from './learn.format'
import { attendanceTextOf, isSessionLive, KNOWN_SESSION_STATUSES, SESSION_STATUS_COLORS, splitSessions } from './learn.sessions'

/** A curriculum lesson a session may cover, as the sidebar shows it. */
export interface SessionLesson {
  title: LocalizedLabel
  available: boolean
}

export interface ClassSessionsProps {
  sessions: readonly WorkspaceSession[]
  /** The lessons of the workspace by id: a session covering one the learner can open links to it. */
  lessons: ReadonlyMap<string, SessionLesson>
  itemPath: (itemId: string) => string
  /** Base of the element ids (the sidebar and the drawer each render one). */
  idBase: string
  onPick?: () => void
}

export function ClassSessions({ sessions, lessons, itemPath, idBase, onPick }: ClassSessionsProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [pastOpen, setPastOpen] = useState(false)
  // What is ahead and what is behind, as of when the sidebar was shown.
  const [now] = useState(() => Date.now())
  if (sessions.length === 0) return null
  const { upcoming, past } = splitSessions(sessions, now)
  const titleId = `${idBase}-title`
  const listId = `${idBase}-list`
  const pastId = `${idBase}-past`
  return (
    <section className="learn-csessions" aria-labelledby={titleId} data-testid="learn-class-sessions">
      <h2 className="learn-csessions__heading">
        <button type="button" className="learn-level__toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
          <CalendarOutlined className="learn-kind-icon" aria-hidden />
          <span className="learn-level__name" id={titleId}>
            {t('learn.classSessions.title')}
          </span>
          <span className="learn-level__count">{t('learn.classSessions.upcomingCount', { count: upcoming.length })}</span>
          <DownOutlined className="learn-level__chevron" aria-hidden />
        </button>
      </h2>
      {open ? (
        <div className="learn-csessions__body" id={listId}>
          {upcoming.length > 0 ? (
            <ul className="learn-csessions__list" aria-label={t('learn.classSessions.upcoming')}>
              {upcoming.map((session) => (
                <SessionRow key={session.id} session={session} now={now} lessons={lessons} itemPath={itemPath} onPick={onPick} />
              ))}
            </ul>
          ) : (
            <p className="learn-muted learn-csessions__empty">{t('learn.classSessions.noUpcoming')}</p>
          )}
          {past.length > 0 ? (
            <>
              <button
                type="button"
                className="learn-csessions__past-toggle"
                aria-expanded={pastOpen}
                aria-controls={pastId}
                onClick={() => setPastOpen((value) => !value)}
              >
                <span>{t('learn.classSessions.past', { n: past.length })}</span>
                <DownOutlined className="learn-level__chevron" aria-hidden />
              </button>
              {pastOpen ? (
                <ul className="learn-csessions__list" id={pastId} aria-label={t('learn.classSessions.pastLabel')}>
                  {past.map((session) => (
                    <SessionRow key={session.id} session={session} now={now} lessons={lessons} itemPath={itemPath} onPick={onPick} />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

interface SessionRowProps {
  session: WorkspaceSession
  now: number
  lessons: ReadonlyMap<string, SessionLesson>
  itemPath: (itemId: string) => string
  onPick?: () => void
}

function SessionRow({ session, now, lessons, itemPath, onPick }: SessionRowProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const zone = session.timeZone
  const cancelled = session.status === 'cancelled'
  const attendance = attendanceTextOf(session, t, now)
  const lesson = session.syllabusItemId ? lessons.get(session.syllabusItemId) : undefined
  const live = !cancelled && isSessionLive(session, now)
  return (
    <li className="learn-csession" data-session-id={session.id}>
      <strong className="learn-csession__title">{localizedLabel(session.title, language)}</strong>
      <span className="learn-muted learn-csession__when">
        {formatLessonDay(session.startsAt, language, zone)} · <bdi dir="ltr">{formatLessonTimes(session.startsAt, session.endsAt, language, zone)}</bdi>
        {differsFromDevice(zone) ? <> ({t('learn.live.zone', { zone })})</> : null}
      </span>
      {lesson && session.syllabusItemId ? (
        lesson.available ? (
          <Link className="learn-csession__lesson" to={itemPath(session.syllabusItemId)} onClick={onPick}>
            <BookOutlined aria-hidden />
            <span>{t('learn.classSessions.lesson', { title: localizedLabel(lesson.title, language) })}</span>
          </Link>
        ) : (
          <span className="learn-muted learn-csession__lesson">
            <LockOutlined aria-hidden />
            <span>{t('learn.classSessions.lessonLocked', { title: localizedLabel(lesson.title, language) })}</span>
          </span>
        )
      ) : null}
      <span className="learn-csession__meta">
        {KNOWN_SESSION_STATUSES.has(session.status) ? (
          <Tag color={SESSION_STATUS_COLORS[session.status]} bordered={false}>
            {t(`learn.live.status.${session.status}`)}
          </Tag>
        ) : null}
        {live ? (
          <Tag color="red" bordered={false}>
            {t('learn.classSessions.live')}
          </Tag>
        ) : null}
        {attendance ? <span className="learn-csession__attendance">{attendance}</span> : null}
      </span>
      {!cancelled && session.meetingUrl && isHttpsUrl(session.meetingUrl) ? (
        <Button
          className="learn-csession__join"
          size="small"
          icon={<VideoCameraOutlined aria-hidden />}
          href={session.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('learn.classSessions.join')}
          <span className="learn-sr-only"> {t('learn.lesson.newTab')}</span>
        </Button>
      ) : null}
    </li>
  )
}
