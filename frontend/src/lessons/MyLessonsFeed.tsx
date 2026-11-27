// A guardian's «دروسي» since J-F67 (CH-0243, Jallal's request; a student gets the course panels instead —
// `learn/hub/AllCoursesLessons.tsx`): every lesson of their children's classes from API-101, newest first, drawn like the lessons panel of a course in «دوراتي» (`learn/hub/hub.css`:
// the panel head with its pills, one rounded row per lesson with its badges and one button). One row per lesson ×
// student, as the table it replaces (`MyLessonsList`, which one class's page keeps). The pills are the list's views:
// «كل الدروس» (newest first — the default), «اليوم والقادمة» (oldest first) and «السابقة» (newest first). Each row
// shows its times in the lesson's own zone and the days are the academy's (D-R41) — without the note naming the zones
// that the table shows (removed at Jallal's request); the student's OWN attendance only,
// never the teacher's note (the DTO does not carry it). Pages follow the server's cursor. Since J-F80 a student's
// «دروسي» shows this feed too (`variant: 'student'` — its own title and hint: the class lessons their teachers add),
// and every row that is not cancelled offers the lesson's video («مشاهدة الفيديو») beside the join link and lists
// its books and links (J-F77).
import { BookOutlined, CalendarOutlined, CheckCircleFilled, CloseCircleOutlined, EnvironmentOutlined, LinkOutlined, PlayCircleOutlined, TeamOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import type { MyLessonItem } from '../api/myLessons'
import { useAuth } from '../auth/auth-context'
import type { useMyClasses } from '../enrollments/useMyClasses'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { LessonAttachmentLinks } from './LessonAttachmentLinks'
import { describeLessonsFailure, failureMessage } from './lessons.errors'
import { formatLessonDay, formatLessonTimes, lessonRoomLabel, lessonTitle } from './lessons.format'
import { attendanceCellOf, myLessonKey, showsStudents } from './myLessons.view'
import type { MyLessonView } from './myLessons.view'
import { useMyLessons } from './useMyLessons'

/** The views the pills offer; a custom range stays on one class's page. */
const FEED_VIEWS: readonly MyLessonView[] = ['all', 'upcoming', 'past']

/** The colour of a recorded attendance: present green, late amber, absent red, excused grey. */
const ATTENDANCE_BADGE: Record<string, string> = { present: 'hub-badge--done', late: 'hub-badge--progress', absent: 'hub-badge--danger', excused: 'hub-badge--kind' }

interface MyLessonsFeedProps {
  /** The zone of «today»: the academy's, or this device's when the academy could not be read. */
  dayZone: string
  /** «My courses» (API-060): it tells a learner without any enrollment why the list is empty. */
  myClasses: ReturnType<typeof useMyClasses>
  /** J-F80: `student` = the class lessons panel of a student's «دروسي» (its own title and hint); a guardian's feed by default. */
  variant?: 'guardian' | 'student'
}

export function MyLessonsFeed({ dayZone, myClasses, variant = 'guardian' }: MyLessonsFeedProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const list = useMyLessons(dayZone)
  const { filters } = list
  const showStudent = showsStudents(user?.roles ?? [], list.items)
  const failure = list.error ? describeLessonsFailure(list.error) : null
  const noEnrollment = !myClasses.loading && !myClasses.error && myClasses.items.length === 0
  const student = variant === 'student'
  const title = t(student ? 'myLessons.feed.classTitle' : 'myLessons.feed.title')
  const emptyText = noEnrollment ? t('myLessons.empty.noEnrollment') : t(`myLessons.empty.${filters.view === 'range' ? 'all' : filters.view}`)

  return (
    <section className="hub-panel" aria-label={title}>
      <div className="hub-panel__head">
        <div>
          <h2 className="hub-panel__title">{title}</h2>
          <p className="hub-panel__hint">{t(student ? 'myLessons.feed.classHint' : filters.view === 'upcoming' ? 'myLessons.feed.hintUpcoming' : 'myLessons.feed.hint')}</p>
        </div>
        <div className="hub-panel__tools">
          <div className="hub-pills" role="group" aria-label={t('myLessons.views.label')}>
            {FEED_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                className={`hub-pill${filters.view === view ? ' is-active' : ''}`}
                aria-pressed={filters.view === view}
                // «كل الدروس» is newest first here; the other two fix their own order.
                onClick={() => list.setFilters(view === 'all' ? { view, order: 'desc' } : { view })}
              >
                {t(`myLessons.views.${view}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
              {t('myLessons.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {list.loading && list.items.length === 0 ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : list.items.length === 0 ? (
        failure ? null : (
          <div className="hub-empty">
            <h3>{emptyText}</h3>
          </div>
        )
      ) : (
        <ol className="hub-list" aria-busy={list.loading}>
          {list.items.map((item) => (
            <FeedRow key={myLessonKey(item)} item={item} showStudent={showStudent} />
          ))}
        </ol>
      )}

      {list.canGoBack || list.nextCursor ? (
        <div className="hub-feed__pages">
          <button type="button" className="hub-btn hub-btn--open" onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('lessons.pagination.previous')}
          </button>
          <span>{t('lessons.pagination.page', { page: list.pageNumber })}</span>
          <button type="button" className="hub-btn hub-btn--open" onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('lessons.pagination.next')}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function FeedRow({ item, showStudent }: { item: MyLessonItem; showStudent: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const cancelled = item.status === 'cancelled'
  const completed = item.status === 'completed'
  const online = item.deliveryMode === 'live_online' || item.deliveryMode === 'hybrid'
  const attendance = attendanceCellOf(item)
  const title = lessonTitle(item, language)
  const joinable = item.meetingUrl !== null && item.status === 'scheduled'

  return (
    <li className={`hub-row${cancelled ? ' is-locked' : ''}`} data-testid={`my-lesson-${myLessonKey(item)}`}>
      <span className="hub-row__number" aria-hidden>
        {completed ? <CheckCircleFilled /> : cancelled ? <CloseCircleOutlined /> : <CalendarOutlined />}
      </span>
      <div className="hub-row__main">
        <div className="hub-row__badges">
          <span className={`hub-badge ${online ? 'hub-badge--live' : 'hub-badge--recorded'}`}>
            {online ? <VideoCameraOutlined aria-hidden /> : null} {t(`labels.${item.deliveryMode}`)}
          </span>
          <span className={`hub-badge ${completed ? 'hub-badge--done' : cancelled ? 'hub-badge--kind' : 'hub-badge--progress'}`}>
            {completed ? <CheckCircleFilled aria-hidden /> : null} {t(`labels.${item.status}`)}
          </span>
          {attendance.kind === 'recorded' ? (
            <span className={`hub-badge ${ATTENDANCE_BADGE[attendance.status] ?? 'hub-badge--kind'}`}>
              {t(`lessons.attendance.${attendance.status}`)}
              {attendance.minutesLate !== null ? ` · ${t('myLessons.attendance.minutes', { count: attendance.minutesLate })}` : ''}
            </span>
          ) : null}
        </div>
        <h4 className="hub-row__title">{cancelled ? <s>{title}</s> : title}</h4>
        <div className="hub-row__meta">
          <span>
            <CalendarOutlined aria-hidden /> {formatLessonDay(item.startsAt, language, item.timeZone)} · <bdi dir="ltr">{formatLessonTimes(item.startsAt, item.endsAt, language, item.timeZone)}</bdi>
          </span>
          <span>
            <BookOutlined aria-hidden /> {`${localizedLabel(item.class.name, language)} · ${localizedLabel(item.class.course.name, language)}`}
          </span>
          {item.teacher ? (
            <span>
              <UserOutlined aria-hidden /> {displayNameOf(item.teacher)}
            </span>
          ) : null}
          {item.room ? (
            <span>
              <EnvironmentOutlined aria-hidden /> <bdi dir="ltr">{lessonRoomLabel(item.room, language)}</bdi>
            </span>
          ) : null}
          {showStudent ? (
            <span>
              <TeamOutlined aria-hidden /> {displayNameOf(item.student)} ({t(`myClasses.relation.${item.relation}`)})
            </span>
          ) : null}
        </div>
        {/* J-F77: the lesson's video and its books and links (none for a cancelled lesson). */}
        {cancelled ? null : <LessonAttachmentLinks attachments={item.attachments} />}
      </div>
      <div className="hub-row__actions">
        {joinable ? (
          <a className="hub-btn hub-btn--live" href={item.meetingUrl!} target="_blank" rel="noopener noreferrer">
            <LinkOutlined aria-hidden /> {t('myLessons.feed.join')}
            <span className="hub-sr-only">: {title}</span>
          </a>
        ) : null}
        {/* J-F77/J-F80: the lesson's video — a recorded lesson's, or a live lesson's recording. */}
        {!cancelled && item.recordingUrl ? (
          <a className="hub-btn hub-btn--play" href={item.recordingUrl} target="_blank" rel="noopener noreferrer">
            <PlayCircleOutlined aria-hidden /> {t('lessons.attachments.watchVideo')}
            <span className="hub-sr-only">: {title}</span>
          </a>
        ) : null}
      </div>
    </li>
  )
}
