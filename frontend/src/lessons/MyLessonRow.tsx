// One class lesson of a learner (API-101) as a row in the look of a course's lessons panel (`learn/hub/hub.css`): its
// kind and status, the student's OWN attendance, the day and times in the lesson's own zone, and — unless it is
// cancelled — the join link while it is scheduled, the lesson's video and its books and links (J-F77).
// Drawn by a guardian's «دروسي» and a student's «دروس الفصل» there (`MyLessonsFeed` — J-F67/J-F80), and since J-F81 by
// the course panel under the cards of «دوراتي» (`learn/hub/HubLessons.tsx`), which leaves out the class line its
// heading already names (`showClass: false`).
// Since J-F81 (Jallal's request) every button sits beside «الانضمام», as on a curriculum row: the video, the lesson's
// exam («الاختبار» — the exam popup, when the panel hands the row its exams) and its attachments («المرفق», or a menu
// «المرفقات (n)», each in a new tab) — none for a cancelled lesson.
// Since J-F83 (Jallal's request) «الانضمام» and «مشاهدة الفيديو» take the look of the service their link opens
// (`LessonLinkButton`: YouTube, Zoom, Google Meet), and a recorded lesson keeps «الانضمام» to its video after it ended.
import { BookOutlined, CalendarOutlined, CheckCircleFilled, CloseCircleOutlined, EnvironmentOutlined, TeamOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { WorkspaceItemExam } from '../api/learning'
import type { MyLessonItem } from '../api/myLessons'
import { useLocalized } from '../i18n/useLocalized'
import { LessonExams } from '../learn/hub/LessonExams'
import { ResourcesButton } from '../learn/hub/ResourcesButton'
import { displayNameOf, localizedLabel } from '../users/users.format'
import { LessonLinkButton } from './LessonLinkButton'
import { formatLessonDay, formatLessonTimes, lessonRoomLabel, lessonTitle } from './lessons.format'
import { attendanceCellOf, myLessonKey } from './myLessons.view'

/** The colour of a recorded attendance: present green, late amber, absent red, excused grey. */
const ATTENDANCE_BADGE: Record<string, string> = { present: 'hub-badge--done', late: 'hub-badge--progress', absent: 'hub-badge--danger', excused: 'hub-badge--kind' }

export interface MyLessonRowProps {
  item: MyLessonItem
  /** Name the student and their relation (a guardian, or a list holding a child's lesson). */
  showStudent: boolean
  /** Name the class and its course; false where the panel's heading already names them. */
  showClass?: boolean
  /** J-F81: the exams linked to this lesson (the course panel of «دوراتي» reads them); none = no exam button. */
  exams?: readonly WorkspaceItemExam[]
  /** An exam popup of the row closed: the panel reads the exams again. */
  onExamClosed?: () => void
}

export function MyLessonRow({ item, showStudent, showClass = true, exams = [], onExamClosed }: MyLessonRowProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const cancelled = item.status === 'cancelled'
  const completed = item.status === 'completed'
  const online = item.deliveryMode === 'live_online' || item.deliveryMode === 'hybrid'
  const attendance = attendanceCellOf(item)
  const title = lessonTitle(item, language)
  // J-F83: a live lesson can be joined until it ends; a recorded lesson's link (its video) stays open after it ended.
  const joinable = item.meetingUrl !== null && !cancelled && (item.status === 'scheduled' || item.status === 'in_progress' || item.deliveryMode === 'recorded')

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
          {showClass ? (
            <span>
              <BookOutlined aria-hidden /> {`${localizedLabel(item.class.name, language)} · ${localizedLabel(item.class.course.name, language)}`}
            </span>
          ) : null}
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
      </div>
      <div className="hub-row__actions">
        {/* J-F83: each link in the look of its service — YouTube, Zoom, Google Meet — else the academy's own. */}
        {joinable ? <LessonLinkButton url={item.meetingUrl!} label={t('myLessons.feed.join')} context={title} kind="join" /> : null}
        {/* J-F77/J-F80: the lesson's video — a recorded lesson's, or a live lesson's recording. */}
        {!cancelled && item.recordingUrl ? <LessonLinkButton url={item.recordingUrl} label={t('lessons.attachments.watchVideo')} context={title} kind="watch" /> : null}
        {/* J-F81: the lesson's exam and its books and links, beside «الانضمام» (none for a cancelled lesson). */}
        {cancelled ? null : (
          <>
            <LessonExams exams={exams} lessonTitle={title} onClosed={onExamClosed} />
            <ResourcesButton
              resources={item.attachments}
              label={t('myLessons.hub.row.file')}
              labelMany={t('myLessons.hub.row.files', { n: item.attachments.length })}
              context={title}
              className="hub-btn--open"
            />
          </>
        )}
      </div>
    </li>
  )
}
