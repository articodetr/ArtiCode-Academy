// «الاختبارات والشهادة» under the lessons of a course in «دروسي» (J-F67,
// ADR-049): the three steps — lessons, exams, certificate — the class's exams
// with the same «start / continue» control as «my exams», and the certificate.
// Every state is the server's (API-070): this page computes no percentage and
// no eligibility, and the button appears only when the server says `ready`.
import { CheckCircleFilled, ExportOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, App, Button, Skeleton, Tag } from 'antd'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import type { MyLearningCourse } from '../../api/learning'
import { claimCertificate } from '../../api/myCertificates'
import type { EnrollmentCompletion } from '../../api/myCertificates'
import type { MyExamItem } from '../../api/myExams'
import { myCertificatePrintPath } from '../../certificates/certificates.links'
import { examTitle } from '../../exams/exams.format'
import { isOnlineItem, myExamKey, onlineResultCellOf, resultCellOf } from '../../exams/myExams.view'
import type { OnlineMyExamItem } from '../../exams/myExams.view'
import { useLocalized } from '../../i18n/useLocalized'
import { OnlineTake } from '../../takeExam/MyExamOnline'
import { StartAttemptModal } from '../../takeExam/StartAttemptModal'
import './hubCompletion.css'
import { useHubCompletion } from './useHubCompletion'

export interface HubCompletionProps {
  course: MyLearningCourse
  /** The course's completed required lessons: a change reads the state again. */
  version: number
}

export function HubCompletion({ course, version }: HubCompletionProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const reading = useHubCompletion(course.enrollmentId, course.class.id, course.student.id, version)
  const [starting, setStarting] = useState<OnlineMyExamItem | null>(null)
  const [claiming, setClaiming] = useState(false)
  const busy = useRef(false)

  if (reading.loading) {
    return (
      <section className="hub-finish">
        <Skeleton active paragraph={{ rows: 3 }} />
      </section>
    )
  }
  if (reading.data === null) {
    // A caller the server does not let read this (no key, not their enrollment) simply has no such section.
    if (reading.error instanceof ApiError && (reading.error.status === 403 || reading.error.status === 404)) return null
    return (
      <section className="hub-finish">
        <Alert
          type="warning"
          showIcon
          title={t('myLessons.hub.finish.loadFailed')}
          action={
            <Button size="small" onClick={reading.reload}>
              {t('learn.load.retry')}
            </Button>
          }
        />
      </section>
    )
  }

  const { completion, exams } = reading.data
  // An academy that issues through its office, on a course without exams: nothing to show here.
  if (completion.state === 'not_offered' && exams.length === 0) return null

  const claim = async () => {
    if (busy.current) return
    busy.current = true
    setClaiming(true)
    try {
      await claimCertificate(course.enrollmentId)
      message.success(t('myLessons.hub.finish.claimed'))
    } catch (error) {
      if (error instanceof ApiError && error.code === 'certificate_not_ready') message.warning(t('myLessons.hub.finish.notReady'))
      else message.error(t('myLessons.hub.finish.claimFailed'))
    } finally {
      busy.current = false
      setClaiming(false)
      reading.reload()
    }
  }

  const doneWork = completion.work.filter((item) => item.done).length
  const lessonsDone = completion.lessons.required > 0 && completion.lessons.completed >= completion.lessons.required
  const workDone = completion.work.length > 0 && doneWork === completion.work.length
  const issued = completion.state === 'issued'

  return (
    <section className="hub-finish" aria-label={t('myLessons.hub.finish.title')}>
      <div className="hub-finish__head">
        <h3 className="hub-finish__title">
          <SafetyCertificateOutlined aria-hidden /> {t('myLessons.hub.finish.title')}
        </h3>
        <p className="hub-finish__hint">{t('myLessons.hub.finish.hint')}</p>
      </div>

      <ol className="hub-steps">
        <Step number={1} label={t('myLessons.hub.finish.steps.lessons')} value={`${completion.lessons.completed} / ${completion.lessons.required}`} done={lessonsDone} />
        <Step number={2} label={t('myLessons.hub.finish.steps.exams')} value={`${doneWork} / ${completion.work.length}`} done={workDone} />
        <Step number={3} label={t('myLessons.hub.finish.steps.certificate')} value={t(issued ? 'myLessons.hub.finish.steps.issued' : 'myLessons.hub.finish.steps.notYet')} done={issued} />
      </ol>

      {exams.length > 0 ? (
        <ul className="hub-exams">
          {exams.map((item) => (
            <ExamRow key={myExamKey(item)} item={item} done={completion.work.some((work) => work.id === item.id && work.done)} onStart={setStarting} onStale={reading.reload} />
          ))}
        </ul>
      ) : (
        <p className="hub-finish__empty">{t('myLessons.hub.finish.noExams')}</p>
      )}

      <CertificateBox completion={completion} claiming={claiming} onClaim={() => void claim()} />
      <StartAttemptModal item={starting} onClose={() => setStarting(null)} onRefused={reading.reload} />
    </section>
  )
}

function Step({ number, label, value, done }: { number: number; label: string; value: string; done: boolean }) {
  return (
    <li className={`hub-step${done ? ' is-done' : ''}`}>
      <span className="hub-step__mark" aria-hidden>
        {done ? <CheckCircleFilled /> : number}
      </span>
      <span className="hub-step__text">
        <span className="hub-step__label">{label}</span>
        <bdi dir="auto" className="hub-step__value">
          {value}
        </bdi>
      </span>
    </li>
  )
}

function ExamRow({ item, done, onStart, onStale }: { item: MyExamItem; done: boolean; onStart: (item: OnlineMyExamItem) => void; onStale: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <li className={`hub-exam${done ? ' is-done' : ''}`}>
      <div className="hub-exam__main">
        <div className="hub-exam__tags">
          <Tag>{t(`exams.types.${item.type}`)}</Tag>
          {done ? (
            <Tag color="green" icon={<CheckCircleFilled aria-hidden />}>
              {t('myLessons.hub.finish.examDone')}
            </Tag>
          ) : null}
        </div>
        <h4 className="hub-exam__title">{examTitle(item, language)}</h4>
        <ExamOutcome item={item} />
      </div>
      {/* A finished exam of a completed enrollment has nothing left to offer: «needs an active enrollment» would only confuse. */}
      {isOnlineItem(item) && !(done && item.online.blocker === 'not_enrolled') ? (
        <div className="hub-exam__action">
          <OnlineTake item={item} onStart={onStart} onStale={onStale} />
        </div>
      ) : null}
    </li>
  )
}

/** The student's own result as the server sent it, or when it will come. */
function ExamOutcome({ item }: { item: MyExamItem }) {
  const { t } = useTranslation()
  const cell = isOnlineItem(item) ? onlineResultCellOf(item) : resultCellOf(item)
  if (cell.kind === 'result') {
    if (cell.status === 'scored' && cell.score !== null) {
      return (
        <p className="hub-exam__result">
          {t('myLessons.hub.finish.score')}{' '}
          <strong>
            <bdi dir="ltr">
              {cell.score} / {item.maxScore}
            </bdi>
          </strong>
        </p>
      )
    }
    return <p className="hub-exam__result">{t(`exams.results.status.${cell.status}`)}</p>
  }
  if (cell.kind === 'afterSubmit') return <p className="hub-exam__result is-muted">{t('takeExam.list.result.afterSubmit')}</p>
  return <p className="hub-exam__result is-muted">{t(cell.kind === 'none' ? 'myLessons.hub.finish.noResult' : 'myLessons.hub.finish.awaitingResult')}</p>
}

function CertificateBox({ completion, claiming, onClaim }: { completion: EnrollmentCompletion; claiming: boolean; onClaim: () => void }) {
  const { t } = useTranslation()
  const { state, grade, certificate, lessons, work } = completion
  const text = t(`myLessons.hub.finish.states.${state}`, {
    percent: grade?.percent ?? 0,
    left: state === 'lessons_pending' ? Math.max(0, lessons.required - lessons.completed) : work.filter((item) => !item.done).length,
  })
  return (
    <div className={`hub-cert hub-cert--${state === 'issued' || state === 'ready' ? 'ok' : 'wait'}`} role="status">
      <SafetyCertificateOutlined className="hub-cert__icon" aria-hidden />
      <div className="hub-cert__body">
        <strong>{t('myLessons.hub.finish.certificateTitle')}</strong>
        <span>{text}</span>
        {state === 'issued' && certificate ? (
          <span className="hub-cert__serial">
            {t('myLessons.hub.finish.serial')} <bdi dir="ltr">{certificate.serial}</bdi>
          </span>
        ) : null}
      </div>
      <div className="hub-cert__actions">
        {state === 'ready' ? (
          <Button type="primary" size="large" loading={claiming} onClick={onClaim}>
            {t('myLessons.hub.finish.claim')}
          </Button>
        ) : null}
        {state === 'issued' && certificate ? (
          <>
            <Button type="primary" icon={<ExportOutlined aria-hidden />} href={myCertificatePrintPath(certificate.id)} target="_blank" rel="noopener noreferrer">
              {t('myLessons.hub.finish.open')}
            </Button>
            <Link to="/my-certificates">{t('myLessons.hub.finish.allCertificates')}</Link>
          </>
        ) : null}
      </div>
    </div>
  )
}
