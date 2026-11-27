// The exam of a lesson beside its main button (J-F67, Jallal's request): «الاختبار» opens the exam in a popup
// (LessonExamModal); «تم الاختبار» once the learner has taken every exam of the lesson; more than one is a small menu.
// Used by a curriculum row (HubRow — API-230 lists its exams) and, since J-F81, by a class lesson row (MyLessonRow — the
// class's exams from «my exams», API-121, linked to that lesson).
import { CheckCircleFilled, DownOutlined, FileTextOutlined } from '@ant-design/icons'
import { Dropdown } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceItemExam } from '../../api/learning'
import { useLocalized } from '../../i18n/useLocalized'
import { LessonExamModal } from '../../takeExam/LessonExamModal'
import { localizedLabel } from '../../users/users.format'

/** The lesson's exam (or a menu of its exams), opened in a popup: the exam's own page, in place (J-F67). */
export function LessonExams({ exams, lessonTitle, onClosed }: { exams: readonly WorkspaceItemExam[]; lessonTitle: string; onClosed?: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [opened, setOpened] = useState<WorkspaceItemExam | null>(null)
  if (exams.length === 0) return null
  const close = () => {
    setOpened(null)
    onClosed?.()
  }
  const popup = opened ? <LessonExamModal key={opened.id} examId={opened.id} title={localizedLabel(opened.title, language)} onClose={close} /> : null
  // «تم الاختبار» once the learner has taken every exam of the lesson (one, as a rule).
  const allDone = exams.every((exam) => exam.done === true)
  if (exams.length === 1) {
    const exam = exams[0]!
    return (
      <>
        <button type="button" className={`hub-btn ${allDone ? 'hub-btn--exam-done' : 'hub-btn--exam'}`} title={localizedLabel(exam.title, language)} onClick={() => setOpened(exam)}>
          {allDone ? <CheckCircleFilled aria-hidden /> : <FileTextOutlined aria-hidden />} {t(allDone ? 'myLessons.hub.row.examDone' : 'myLessons.hub.row.exam')}
          <span className="learn-sr-only">: {lessonTitle}</span>
        </button>
        {popup}
      </>
    )
  }
  return (
    <>
      <Dropdown
        trigger={['click']}
        destroyOnHidden
        menu={{
          items: exams.map((exam) => ({ key: exam.id, icon: exam.done ? <CheckCircleFilled aria-hidden /> : undefined, label: exam.done ? `${localizedLabel(exam.title, language)} — ${t('myLessons.hub.row.examDone')}` : localizedLabel(exam.title, language) })),
          onClick: ({ key }) => setOpened(exams.find((exam) => exam.id === key) ?? null),
        }}
      >
        <button type="button" className={`hub-btn ${allDone ? 'hub-btn--exam-done' : 'hub-btn--exam'}`}>
          {allDone ? <CheckCircleFilled aria-hidden /> : <FileTextOutlined aria-hidden />} {t('myLessons.hub.row.exams', { n: exams.length })} <DownOutlined aria-hidden />
          <span className="learn-sr-only">: {lessonTitle}</span>
        </button>
      </Dropdown>
      {popup}
    </>
  )
}
