// The lessons of the learner home (J-F63): what runs now — or comes next — on top with its «join» button, then a short
// list of the rest of the coming days. The link is the server's (`meetingUrl`, https only); lessonLinkOf() decides
// whether it reads «join» or «open the link» (KI-062).
import { PlayCircleOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Button, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { MyLessonItem } from '../api/myLessons'
import { ATTENDANCE_STATUS_COLORS } from '../attendance/attendance.format'
import { useLocalized } from '../i18n/useLocalized'
import { SESSIONS_PATH } from '../learn/hub/hub.view'
import { formatLessonTimes } from '../lessons/lessons.format'
import { useIsPhone } from '../mySchool/useMyLearning'
import { labelIn, wallDate } from './dashboard.data'
import { LESSON_ROWS_MAX, LESSON_ROWS_PHONE, daysUntil, lessonBoardOf, lessonLinkOf } from './learner.data'
import { Loading, Panel } from './LearnerPanel'
import type { DayContext, StudentName } from './LearnerPanel'
import type { Loaded } from './useLoad'

interface LessonsPanelProps {
  lessons: Loaded<MyLessonItem[]>
  day: DayContext
  showStudent: boolean
  studentName: StudentName
}

function useLessonText(day: DayContext, showStudent: boolean, studentName: StudentName) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const localized = (text: Parameters<typeof labelIn>[0]) => labelIn(text, language)
  const dayLabel = (date: string) => {
    if (date === day.today) return t('dashboard.learner.today')
    if (daysUntil(date, day.today) === 1) return t('dashboard.learner.tomorrow')
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-u-nu-latn' : language, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
  }
  const meta = (lesson: MyLessonItem) => {
    const title = localized(lesson.title)
    const className = localized(lesson.class.name)
    const where = lesson.room ? (lesson.room.name ? localized(lesson.room.name) : lesson.room.code) : t('dashboard.online')
    return [className !== title ? className : null, lesson.teacher?.fullName, where, showStudent ? studentName(lesson.student) : null].filter(Boolean).join(' · ')
  }
  return { t, language, localized, dayLabel, meta }
}

function LessonLink({ lesson, now, size }: { lesson: MyLessonItem; now: number; size: 'small' | 'large' }) {
  const { t } = useTranslation()
  const link = lessonLinkOf(lesson, now)
  if (!link) return null
  const join = link.action === 'join'
  const watch = link.action === 'watch'
  return (
    <Button
      type={(join || watch) && size === 'large' ? 'primary' : 'default'}
      size={size}
      icon={join ? <VideoCameraOutlined aria-hidden /> : watch ? <PlayCircleOutlined aria-hidden /> : undefined}
      href={link.url}
      target="_blank"
      rel="noreferrer"
    >
      {t(join ? 'dashboard.learner.join' : watch ? 'lessons.attachments.watchVideo' : 'dashboard.learner.openLink')}
      <span className="lh-sr-only"> {t('learn.lesson.newTab')}</span>
    </Button>
  )
}

function AttendanceTag({ lesson }: { lesson: MyLessonItem }) {
  const { t } = useTranslation()
  if (lesson.status === 'cancelled') return <Tag>{t('dashboard.state.cancelled')}</Tag>
  if (!lesson.attendance) return null
  return <Tag color={ATTENDANCE_STATUS_COLORS[lesson.attendance.status]}>{t(`lessons.attendance.${lesson.attendance.status}`)}</Tag>
}

export function LessonsPanel({ lessons, day, showStudent, studentName }: LessonsPanelProps) {
  const { t, language, localized, dayLabel, meta } = useLessonText(day, showStudent, studentName)
  const phone = useIsPhone()
  return (
    <Panel title={t('dashboard.learner.lessons')} extra={<Link to={SESSIONS_PATH}>{t('dashboard.learner.allLessons')}</Link>}>
      <Loading loaded={lessons}>
        {(items) => {
          const board = lessonBoardOf(items, day.now, day.zone, phone ? LESSON_ROWS_PHONE : LESSON_ROWS_MAX)
          if (!board.featured.length && !board.days.length) return <p className="db-muted">{t('dashboard.learner.weekEmpty')}</p>
          return (
            <div className="lh-stack">
              {board.featured.map((lesson) => (
                <article key={`${lesson.id}:${lesson.student.id}`} className={board.live ? 'lh-feature lh-feature--live' : 'lh-feature'}>
                  <div className="lh-feature__body">
                    <span className={board.live ? 'lh-pill lh-pill--live' : 'lh-pill'}>{t(board.live ? 'dashboard.learner.liveNow' : 'dashboard.learner.nextLesson')}</span>
                    <h3>{localized(lesson.title)}</h3>
                    <p>
                      {dayLabel(wallDate(lesson.startsAt, day.zone))} ·{' '}
                      <bdi dir="ltr" className="tabular-nums">
                        {formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}
                      </bdi>
                    </p>
                    <small>{meta(lesson)}</small>
                  </div>
                  <div className="lh-feature__action">
                    <AttendanceTag lesson={lesson} />
                    <LessonLink lesson={lesson} now={day.now} size="large" />
                  </div>
                </article>
              ))}
              {board.days.length ? (
                <ol className="lh-agenda">
                  {board.days.map(({ date, lessons: ofDay }) => (
                    <li key={date}>
                      <h3 className={date === day.today ? 'lh-day lh-day--today' : 'lh-day'}>{dayLabel(date)}</h3>
                      <ul>
                        {ofDay.map((lesson) => {
                          const ended = Date.parse(lesson.endsAt) <= day.now
                          const rowClass = lesson.status === 'cancelled' ? 'lh-lesson lh-lesson--cancelled' : ended ? 'lh-lesson lh-lesson--past' : 'lh-lesson'
                          return (
                            <li key={`${lesson.id}:${lesson.student.id}`} className={rowClass}>
                              <span className="lh-lesson__time tabular-nums" dir="ltr">
                                {formatLessonTimes(lesson.startsAt, lesson.endsAt, language, lesson.timeZone)}
                              </span>
                              <span className="lh-lesson__body">
                                <b>{localized(lesson.title)}</b>
                                <small>{meta(lesson)}</small>
                              </span>
                              <span className="lh-lesson__state">
                                <AttendanceTag lesson={lesson} />
                                <LessonLink lesson={lesson} now={day.now} size="small" />
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  ))}
                </ol>
              ) : null}
              {board.hidden > 0 ? (
                <Link className="lh-more-link" to={SESSIONS_PATH}>
                  {t('dashboard.learner.more', { count: board.hidden })}
                </Link>
              ) : null}
            </div>
          )
        }}
      </Loading>
    </Panel>
  )
}
