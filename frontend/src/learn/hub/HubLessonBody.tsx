// The opened lesson inside the popup of «دوراتي» and «دروسي» (J-F69 — Jallal's reference of the lesson popup): a card
// of what the lesson is — «المادة» (the course), «المستوى», «المعلم» (the class's lead teacher), «نوع المحاضرة» and
// «الموعد» (its class session, else «موعد غير محدد») —, the content in its frame (a video in the dark frame with
// «المشاهدة المحتسبة» under it — YouTubeLesson), how it completes (CompletionPanel), a box per exam of the lesson —
// «تم الاجتياز: …» in green once the learner's result passes it (API-121, the rule of «اختبارات الدورة»), else where it
// stands with «ابدأ الاختبار» when the server lets them take it now — and what the lesson carries beside (description,
// resources, assignments — LessonSections; its exams are the boxes above). The way to the previous and the next lesson
// is the popup's side arrows (HubPlayer). Every value is the server's; nothing is computed here but which session to name.
import { CheckCircleFilled, FileTextOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem, MyLearningCourse, PlaybackResult, WorkspaceItemExam } from '../../api/learning'
import { useLoad } from '../../dashboard/useLoad'
import { examGapOf, examNote } from '../../enrollments/certificateGaps'
import { useLocalized } from '../../i18n/useLocalized'
import { formatLessonDateTime } from '../../lessons/lessons.format'
import { LessonExamModal } from '../../takeExam/LessonExamModal'
import { localizedLabel } from '../../users/users.format'
import { CompletionPanel } from '../CompletionPanel'
import { levelName } from '../learn.format'
import { LessonContent } from '../LessonContent'
import { LessonSections } from '../LessonSections'
import { readClassExams } from './classExams'
import { lessonFormOf, lessonSessionOf, teacherNameOf } from './hubLesson.view'

export interface HubLessonBodyProps {
  item: LearningItem
  /** The lesson's course as «دوراتي» lists it (API-229): its name, its lead teacher, its student. */
  course: MyLearningCourse
  /** The lesson's exams with whether each was taken (API-230); empty when it has none. */
  exams: readonly WorkspaceItemExam[]
  /** The learner's class in the course (API-230) — whose exams API-121 reads; null before the workspace arrives. */
  classId: string | null
  onComplete: (itemId: string) => Promise<void>
  onPlayback: (itemId: string, result: PlaybackResult) => void
  /** The academy's zone for exam times (API-231 exams carry none). */
  examZone: string | undefined
  /** An exam popup of the lesson closed: the course is read again (its rows' «تم الاختبار», the certificate). */
  onExamClosed: () => void
}

export function HubLessonBody({ item, course, exams, classId, onComplete, onPlayback, examZone, onExamClosed }: HubLessonBodyProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  // Which session «الموعد» names is decided once per opening: a clock ticking here would move nothing the learner needs.
  const [now] = useState(() => Date.now())
  const session = lessonSessionOf(item.sessions, now)
  const teacher = teacherNameOf(course)
  const facts = 'myLessons.hub.player.facts'

  return (
    <div className="hub-lesson">
      <dl className="hub-lesson__facts" aria-label={t(`${facts}.label`)}>
        <div className="hub-lesson__fact">
          <dt>{t(`${facts}.course`)}</dt>
          <dd>
            <bdi>{localizedLabel(course.course.name, language)}</bdi>
          </dd>
        </div>
        {item.section.id !== null ? (
          <div className="hub-lesson__fact">
            <dt>{t(`${facts}.level`)}</dt>
            <dd>{levelName(item.section, t, language)}</dd>
          </div>
        ) : null}
        <div className="hub-lesson__fact">
          <dt>{t(`${facts}.teacher`)}</dt>
          <dd>{teacher ? <bdi>{teacher}</bdi> : t(`${facts}.noTeacher`)}</dd>
        </div>
        <div className="hub-lesson__fact">
          <dt>{t(`${facts}.kind`)}</dt>
          <dd>{t(`${facts}.kinds.${lessonFormOf(item.kind)}`)}</dd>
        </div>
        <div className="hub-lesson__fact">
          <dt>{t(`${facts}.when`)}</dt>
          <dd>{session ? formatLessonDateTime(session.startsAt, language, session.timeZone) : t(`${facts}.noDate`)}</dd>
        </div>
      </dl>

      <section className="hub-lesson__content">
        <LessonContent item={item} onPlayback={(result) => onPlayback(item.id, result)} onComplete={onComplete} />
      </section>

      <CompletionPanel item={item} onComplete={onComplete} />

      <LessonExamStatus exams={exams} classId={classId} studentId={course.student.id} own={course.relation === 'self'} onClosed={onExamClosed} />

      <LessonSections item={item} examZone={examZone} showExams={exams.length === 0} />
    </div>
  )
}

/**
 * A box per exam of the lesson: «تم الاجتياز: …» once the learner's released result passes it, else where it stands
 * (`examNote`) with «ابدأ الاختبار» / «متابعة الاختبار» when the server lets them take it now. Until «my exams» answers
 * (or when it fails), the workspace's own flag says whether the exam was taken, and «الاختبار» opens it in its popup.
 */
function LessonExamStatus({
  exams,
  classId,
  studentId,
  own,
  onClosed,
}: {
  exams: readonly WorkspaceItemExam[]
  classId: string | null
  studentId: string
  own: boolean
  onClosed: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [refresh, setRefresh] = useState(0)
  const [opened, setOpened] = useState<WorkspaceItemExam | null>(null)
  const enabled = exams.length > 0 && classId !== null
  const reading = useLoad(`hubLessonExams:${classId ?? ''}:${studentId}:${refresh}`, enabled, (signal) => readClassExams(classId ?? '', studentId, signal))
  if (exams.length === 0) return null
  const key = 'myLessons.hub.player.exam'

  return (
    <>
      <ul className="hub-lesson__exams" aria-label={t(`${key}.label`)}>
        {exams.map((exam) => {
          const title = localizedLabel(exam.title, language)
          const row = reading.data?.find((candidate) => candidate.id === exam.id)
          const gap = row ? examGapOf(row) : null
          if (gap?.state === 'passed') {
            return (
              <li key={exam.id} className="hub-lesson__status is-passed">
                <CheckCircleFilled aria-hidden /> <span>{t(`${key}.passed`, { title })}</span>
              </li>
            )
          }
          if (!gap && !reading.loading && exam.done === true) {
            return (
              <li key={exam.id} className="hub-lesson__status is-taken">
                <CheckCircleFilled aria-hidden /> <span>{t(`${key}.taken`, { title })}</span>
              </li>
            )
          }
          const canOpen = own && (gap ? gap.canTake : !reading.loading)
          return (
            <li key={exam.id} className="hub-lesson__status">
              <div className="hub-lesson__status-text">
                <span>
                  <FileTextOutlined aria-hidden /> {t(`${key}.title`, { title })}
                </span>
                {gap ? <span className="hub-lesson__status-note">{examNote(gap, t, language)}</span> : null}
              </div>
              {canOpen ? (
                <button type="button" className="hub-btn hub-btn--exam" onClick={() => setOpened(exam)}>
                  <FileTextOutlined aria-hidden />{' '}
                  {gap
                    ? t(gap.state === 'in_progress' ? 'myLessons.hub.courseExams.resume' : 'myLessons.hub.courseExams.take')
                    : t('myLessons.hub.row.exam')}
                  <span className="learn-sr-only">: {title}</span>
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {opened ? (
        <LessonExamModal
          key={opened.id}
          examId={opened.id}
          title={localizedLabel(opened.title, language)}
          onClose={() => {
            setOpened(null)
            setRefresh((value) => value + 1)
            onClosed()
          }}
        />
      ) : null}
    </>
  )
}
