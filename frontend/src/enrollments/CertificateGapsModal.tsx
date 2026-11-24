// «الشهادة» of a card of «دوراتي» before the certificate is issued (J-F68 — Jallal's request: the button stays on
// every card, and pressing it says what the course still needs). It reads, each time it opens:
// - the student's certificates (API-135) again — the certificate may have been issued since the page was read (the
//   last exam submitted a minute ago): then it says so and links to it, and the card learns it (`onIssued`); a revoked
//   one is named too (the server never issues a second certificate for the course);
// - every exam of the class for that student (API-121, `classId` + `studentId` — `readClassExams()`) to count the ones
//   passed (`certificateGaps.ts` — a mirror of the server's rule);
// - for the learner's own card, the course's workspace (API-230) to name the required lessons left; a guardian's card
//   (a child's course) shows the count only — API-230 serves the caller's own enrollment only.
// The lesson counts are the server's (API-230, else the card's API-229). The exams themselves are listed in one place
// only — «اختبارات الدورة» at the end of the course's lessons on this page (Jallal: no other page): the window counts
// them and «عرض الاختبارات» shows that list; «استعراض الدروس» shows the lessons.
import { CheckCircleFilled, CloseCircleFilled, LockOutlined, MinusCircleOutlined, QuestionCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Skeleton } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MyClassItem } from '../api/enrollments'
import { getLearningWorkspace } from '../api/learning'
import type { ProgressCounts } from '../api/learning'
import { listMyCertificates } from '../api/myCertificates'
import type { MyCertificateItem } from '../api/myCertificates'
import type { MyExamItem } from '../api/myExams'
import { myCertificatePrintPath } from '../certificates/certificates.links'
import { useLocalized } from '../i18n/useLocalized'
import { readClassExams } from '../learn/hub/classExams'
import { levelName } from '../learn/learn.format'
import { formatDay, localizedLabel } from '../users/users.format'
import { certificateFor, certificateGaps, lessonGapsOf } from './certificateGaps'
import type { CertificateGaps, LessonGap } from './certificateGaps'

/** Lessons named at most; the rest are counted. */
const MAX_LESSONS_SHOWN = 8

interface Ready {
  kind: 'ready'
  certificate: MyCertificateItem | null
  exams: MyExamItem[]
  /** API-230's counts and lessons (the learner's own card); null for a child's card or when it could not be read. */
  workspaceCounts: ProgressCounts | null
  lessons: LessonGap[] | null
}

type Reading = { kind: 'loading' } | { kind: 'failed' } | Ready

interface CertificateGapsModalProps {
  row: MyClassItem
  /** The course's counts as the card shows them (API-229); null when the card has none. */
  counts: ProgressCounts | null
  onClose: () => void
  /** Shows the course's lessons below the cards (`exams`: brings its «اختبارات الدورة» into view); null when the card cannot be chosen. */
  onBrowse: ((target: 'lessons' | 'exams') => void) | null
  /** A certificate found on this reading (issued since the page loaded): the card shows it from now on. Keep it stable. */
  onIssued: (certificate: MyCertificateItem) => void
}

export function CertificateGapsModal({ row, counts, onClose, onBrowse, onIssued }: CertificateGapsModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [reading, setReading] = useState<Reading>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const courseName = localizedLabel(row.class.course.name, language)
  const own = row.relation === 'self'
  const { enrollmentId } = row
  const classId = row.class.id
  const courseId = row.class.course.id
  const studentId = row.student.id

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    Promise.all([
      listMyCertificates({ studentId }, signal),
      readClassExams(classId, studentId, signal),
      own ? getLearningWorkspace(courseId, signal).catch(() => null) : Promise.resolve(null),
    ]).then(
      ([certificates, exams, workspace]) => {
        if (signal.aborted) return
        const certificate = certificateFor(certificates.items, { enrollmentId, studentId, courseId })
        if (certificate?.status === 'issued') onIssued(certificate)
        setReading({ kind: 'ready', certificate, exams, workspaceCounts: workspace?.progress ?? null, lessons: workspace ? lessonGapsOf(workspace) : null })
      },
      () => {
        if (!signal.aborted) setReading({ kind: 'failed' })
      },
    )
    return () => controller.abort()
  }, [enrollmentId, classId, courseId, studentId, own, onIssued, tick])

  const reload = () => {
    setReading({ kind: 'loading' })
    setTick((value) => value + 1)
  }

  let body: ReactNode
  let gaps: CertificateGaps | null = null
  if (reading.kind === 'loading') {
    body = <Skeleton active paragraph={{ rows: 4 }} />
  } else if (reading.kind === 'failed') {
    body = (
      <Alert
        type="error"
        showIcon
        title={t('myClasses.certificateGaps.failed')}
        action={
          <Button size="small" onClick={reload}>
            {t('myClasses.certificateGaps.retry')}
          </Button>
        }
      />
    )
  } else if (reading.certificate?.status === 'issued') {
    body = (
      <Alert
        type="success"
        showIcon
        icon={<SafetyCertificateOutlined aria-hidden />}
        title={t('myClasses.certificateGaps.issued')}
        description={
          <a className="hub-btn hub-btn--certificate hub-certgaps__open" href={myCertificatePrintPath(reading.certificate.id)} target="_blank" rel="noopener noreferrer">
            <SafetyCertificateOutlined aria-hidden /> {t('myClasses.certificateGaps.open')}
            <span className="hub-sr-only"> {t('mySchool.card.newTab')}</span>
          </a>
        }
      />
    )
  } else if (reading.certificate?.status === 'revoked') {
    body = <Alert type="warning" showIcon title={t('myClasses.certificateGaps.revoked')} />
  } else {
    gaps = certificateGaps(reading.workspaceCounts ?? counts, reading.exams)
    body = gaps.complete ? <Alert type="info" showIcon title={t('myClasses.certificateGaps.completeNoCertificate')} /> : <GapsList gaps={gaps} lessons={reading.lessons} />
  }
  const showsGaps = gaps !== null && !gaps.complete
  const lessonsMissing = gaps !== null && gaps.lessonsLeft > 0
  const examsMissing = gaps !== null && gaps.exams.some((exam) => exam.state !== 'passed')

  const browse = (target: 'lessons' | 'exams') => {
    onBrowse?.(target)
    onClose()
  }
  const footer = [
    showsGaps && onBrowse && lessonsMissing ? (
      <Button key="lessons" onClick={() => browse('lessons')}>
        {t('myClasses.card.browse')}
      </Button>
    ) : null,
    showsGaps && onBrowse && examsMissing ? (
      <Button key="exams" onClick={() => browse('exams')}>
        {t('myClasses.certificateGaps.exams.show')}
      </Button>
    ) : null,
    <Button key="close" type="primary" onClick={onClose}>
      {t('myClasses.certificateGaps.close')}
    </Button>,
  ]

  return (
    <Modal open title={t('myClasses.certificateGaps.title', { course: courseName })} onCancel={onClose} footer={footer} destroyOnHidden width={580}>
      {body}
    </Modal>
  )
}

function GapsList({ gaps, lessons }: { gaps: CertificateGaps; lessons: LessonGap[] | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const lessonsDone = gaps.lessonsKnown && gaps.lessonsRequired > 0 && gaps.lessonsLeft === 0
  const passed = gaps.exams.filter((exam) => exam.state === 'passed').length
  const examsDone = passed === gaps.exams.length
  let lessonsLine: string
  if (!gaps.lessonsKnown) lessonsLine = t('myClasses.certificateGaps.lessons.unknown')
  else if (gaps.lessonsRequired === 0) lessonsLine = t('myClasses.certificateGaps.lessons.none')
  else if (lessonsDone) lessonsLine = t('myClasses.certificateGaps.lessons.done', { done: gaps.lessonsDone, total: gaps.lessonsRequired })
  else lessonsLine = t('myClasses.certificateGaps.lessons.left', { count: gaps.lessonsLeft, total: gaps.lessonsRequired })

  return (
    <div className="hub-certgaps">
      <p className="hub-certgaps__intro">{t('myClasses.certificateGaps.intro')}</p>

      <section className="hub-certgaps__part" aria-labelledby="certgaps-lessons">
        <h3 id="certgaps-lessons" className="hub-certgaps__heading">
          <PartIcon ok={lessonsDone} known={gaps.lessonsKnown} /> {t('myClasses.certificateGaps.lessons.title')}
        </h3>
        <p className="hub-certgaps__summary" data-testid="certgaps-lessons-summary">
          {lessonsLine}
        </p>
        {!lessonsDone && lessons && lessons.length > 0 ? (
          <ul className="hub-certgaps__list" data-testid="certgaps-lessons">
            {lessons.slice(0, MAX_LESSONS_SHOWN).map((lesson) => (
              <li key={lesson.id} className="hub-certgaps__item">
                <MinusCircleOutlined className="hub-certgaps__missing" aria-hidden />
                <span className="hub-certgaps__text">
                  <span className="hub-certgaps__name">{localizedLabel(lesson.title, language)}</span>
                  {lesson.sectionNumber !== null ? (
                    <span className="hub-certgaps__meta">{levelName({ number: lesson.sectionNumber, title: lesson.sectionTitle }, t, language)}</span>
                  ) : null}
                  {lesson.opensOn ? (
                    <span className="hub-certgaps__meta">
                      <LockOutlined aria-hidden /> {t('myClasses.certificateGaps.lessons.opensOn', { date: formatDay(lesson.opensOn, language) })}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
            {lessons.length > MAX_LESSONS_SHOWN ? <li className="hub-certgaps__more">{t('myClasses.certificateGaps.lessons.more', { count: lessons.length - MAX_LESSONS_SHOWN })}</li> : null}
          </ul>
        ) : null}
      </section>

      {gaps.exams.length > 0 ? (
        <section className="hub-certgaps__part" aria-labelledby="certgaps-exams">
          <h3 id="certgaps-exams" className="hub-certgaps__heading">
            <PartIcon ok={examsDone} known /> {t('myClasses.certificateGaps.exams.title')}
          </h3>
          <p className="hub-certgaps__summary" data-testid="certgaps-exams-summary">
            {t('myClasses.certificateGaps.exams.passed', { passed, total: gaps.exams.length })}
          </p>
          {examsDone ? null : <p className="hub-certgaps__meta">{t('myClasses.certificateGaps.exams.where')}</p>}
        </section>
      ) : null}
    </div>
  )
}

function PartIcon({ ok, known }: { ok: boolean; known: boolean }) {
  if (!known) return <QuestionCircleOutlined className="hub-certgaps__wait" aria-hidden />
  return ok ? <CheckCircleFilled className="hub-certgaps__ok" aria-hidden /> : <CloseCircleFilled className="hub-certgaps__missing" aria-hidden />
}
