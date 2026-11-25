// «اختبارات الدورة» at the end of a course's lessons panel in «دوراتي» (J-F68 — Jallal's request: the course's exams
// show here, on this page, so the learner sees what they have not taken or passed yet — no other page). Every exam of
// the class for the card's student (API-121 `classId` + `studentId`), in the server's order, each with where it stands
// for the certificate (`examGapOf()` — passed, not passed with the score and the pass mark, absent, an attempt running,
// waiting for the result, not taken yet) and, when the server lets the learner take it now (`canStart`), «ابدأ
// الاختبار» / «متابعة الاختبار», which opens the exam in a popup (`LessonExamModal`, as a lesson row does). A guardian
// reads their child's exams and never starts one. The window of the locked «الشهادة» sends the learner here.
import { CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, FileTextOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoad } from '../../dashboard/useLoad'
import { examGapOf, examNote } from '../../enrollments/certificateGaps'
import type { ExamGap } from '../../enrollments/certificateGaps'
import { useLocalized } from '../../i18n/useLocalized'
import { LessonExamModal } from '../../takeExam/LessonExamModal'
import { localizedLabel } from '../../users/users.format'
import { readClassExams } from './classExams'
import { scrollToStart } from './hub.scroll'

export interface CourseExamsProps {
  classId: string
  studentId: string
  /** The learner's own course: they may start an exam; a guardian's (a child's) only reads. */
  own: boolean
  /** Changes when an exam popup of this panel closed (a lesson row's too): the exams are read again. */
  refresh: number
  /** Changes when the learner asked to see the exams (the window of «الشهادة»): the section comes into view once read. */
  focus: number
  /** An exam popup of this section closed. */
  onClosed: () => void
}

export function CourseExams({ classId, studentId, own, refresh, focus, onClosed }: CourseExamsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const exams = useLoad(`courseExams:${classId}:${studentId}:${refresh}`, true, (signal) => readClassExams(classId, studentId, signal))
  const [opened, setOpened] = useState<ExamGap | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const shownFocus = useRef(0)
  const loaded = exams.data !== null

  // Asked from the window of «الشهادة»: once the exams are on screen, bring them into view (once per request).
  useEffect(() => {
    if (focus > 0 && focus !== shownFocus.current && loaded) {
      shownFocus.current = focus
      scrollToStart(sectionRef.current)
    }
  }, [focus, loaded])

  if (exams.loading) return <Skeleton active paragraph={{ rows: 2 }} className="hub-exams" />
  if (exams.error) {
    return (
      <Alert
        className="hub-exams"
        type="error"
        showIcon
        title={t('myLessons.hub.courseExams.loadFailed')}
        action={
          <Button size="small" onClick={exams.retry}>
            {t('myLessons.hub.courseExams.retry')}
          </Button>
        }
      />
    )
  }
  const gaps = (exams.data ?? []).map((item) => ({ gap: examGapOf(item), lesson: item.lesson }))
  if (gaps.length === 0) return null
  const passed = gaps.filter(({ gap }) => gap.state === 'passed').length

  return (
    <section ref={sectionRef} className="hub-level hub-exams" aria-labelledby={`hub-exams-${classId}`} data-testid="course-exams">
      <h3 id={`hub-exams-${classId}`} className="hub-level__title">
        <FileTextOutlined aria-hidden /> {t('myLessons.hub.courseExams.title')}
      </h3>
      <p className="hub-exams__summary">{t('myLessons.hub.courseExams.summary', { passed, total: gaps.length })}</p>
      <ol className="hub-list">
        {gaps.map(({ gap, lesson }) => {
          const title = localizedLabel(gap.title, language)
          return (
            <li key={gap.id} className={`hub-row hub-exam-row is-${gap.state}`} data-testid={`course-exam-${gap.id}`}>
              <span className="hub-row__number" aria-hidden>
                <ExamStateIcon state={gap.state} />
              </span>
              <div className="hub-row__main">
                <h4 className="hub-row__title">{title}</h4>
                <div className="hub-row__meta">
                  <span className="hub-exam-row__note">{examNote(gap, t, language)}</span>
                  {lesson ? <span>{t('myLessons.hub.courseExams.lesson', { title: localizedLabel(lesson.title, language) })}</span> : null}
                </div>
              </div>
              <div className="hub-row__actions">
                {gap.state === 'passed' ? (
                  <span className="hub-btn hub-btn--exam-done hub-exam-row__passed">
                    <CheckCircleFilled aria-hidden /> {t('myLessons.hub.courseExams.passed')}
                  </span>
                ) : own && gap.canTake ? (
                  <button type="button" className="hub-btn hub-btn--exam" onClick={() => setOpened(gap)}>
                    <FileTextOutlined aria-hidden /> {t(gap.state === 'in_progress' ? 'myLessons.hub.courseExams.resume' : 'myLessons.hub.courseExams.take')}
                    <span className="learn-sr-only">: {title}</span>
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      {opened ? (
        <LessonExamModal
          key={opened.id}
          examId={opened.id}
          title={localizedLabel(opened.title, language)}
          onClose={() => {
            setOpened(null)
            onClosed()
          }}
        />
      ) : null}
    </section>
  )
}

function ExamStateIcon({ state }: { state: ExamGap['state'] }) {
  if (state === 'passed') return <CheckCircleFilled className="hub-certgaps__ok" />
  if (state === 'in_progress' || state === 'awaiting_result') return <ClockCircleOutlined className="hub-certgaps__wait" />
  if (state === 'not_started') return <MinusCircleOutlined className="hub-certgaps__missing" />
  return <CloseCircleFilled className="hub-certgaps__missing" />
}
