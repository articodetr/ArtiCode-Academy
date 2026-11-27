// One enrollment of «دوراتي» as a card (J-F67), on the look of the course cards «دروسي» had (J-F64 — `learn/hub/hub.css`):
// the class (API-060) with its course and lead teacher, and — when API-229 lists the enrollment — the course's cover,
// its lesson count and the learner's progress. Every number is the server's (D-R133).
// The card never leads to another page (Jallal's request): a card of a course the learner studies (`isStudyCourse()`)
// is `selectable` — the whole card and «استعراض الدروس» show that course's lessons below the cards, on this page —
// and «الشهادة» is on every card (J-F68, Jallal's request): with an issued certificate of the course (API-135) it opens
// the certificate in a new tab; before that it is a locked button whose press says what the course still needs
// (`CertificateGapsModal`, opened by the page). The course's own materials (API-229 `course.resources` — its
// textbook) add «المقرّر», each file in a new tab.
// No enrollment badge, no class code, no period / class status / enrollment day, no «واصل التعلم».
// Since J-F81 «الدروس: N» adds the class lessons the teacher has added (MOD-06, API-101 — not cancelled) to the
// course's curriculum lessons, and a course without a curriculum lesson says «دروس الفصل: N» instead of «لم تُنشر دروس
// هذه الدورة بعد» while its class has lessons; the progress bar stays the curriculum's (the server's numbers).
import { BookOutlined, FilePdfOutlined, LockOutlined, PlayCircleOutlined, ReadOutlined, SafetyCertificateOutlined, TeamOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import { Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import type { MyClassItem } from '../api/enrollments'
import type { MyLearningCourse, ProgressCounts } from '../api/learning'
import { myCertificatePrintPath } from '../certificates/certificates.links'
import { useLocalized } from '../i18n/useLocalized'
import { ResourcesButton } from '../learn/hub/ResourcesButton'
import { isHttpsUrl } from '../learn/learn.format'
import { hasClassLessons } from '../lessons/myLessons.view'
import { displayNameOf, localizedLabel } from '../users/users.format'

interface MyClassCardProps {
  row: MyClassItem
  /** API-229's answer for this enrollment; null when it does not list it (or could not be read). */
  learning: MyLearningCourse | null
  /** The course's counts as the server last answered them (the lessons panel below may have moved them). */
  counts: ProgressCounts | null
  /** API-229 is still on its way. */
  learningLoading: boolean
  /** Name the student and their relation (a guardian, or a list holding a child's enrollment). */
  showStudent: boolean
  /** Choosing the card shows its course's lessons below the cards; null when the card cannot be chosen. */
  onSelect: (() => void) | null
  /** Its course's lessons are the ones shown below. */
  active: boolean
  /** The id of the course's issued certificate for this student (API-135); null when it has none. */
  certificateId: string | null
  /** «الشهادة» without a certificate: show what the course still needs (J-F68). */
  onShowCertificateGaps: () => void
  /** J-F81: the class lessons of this enrollment that are not cancelled (API-101); null while unknown. */
  classLessons?: number | null
}

export function MyClassCard({ row, learning, counts, learningLoading, showStudent, onSelect, active, certificateId, onShowCertificateGaps, classLessons = null }: MyClassCardProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const className = localizedLabel(row.class.name, language)
  const courseName = localizedLabel(row.class.course.name, language)
  const cover = learning && isHttpsUrl(learning.course.coverImageUrl) ? learning.course.coverImageUrl : null
  const materials = learning?.course.resources ?? []
  // PORTAL-04: the course's school subject (المادة) from API-229; omitted when the course has none.
  const subject = learning?.course.subject ? localizedLabel(learning.course.subject.name, language) : null
  const teacherLessons = classLessons ?? 0
  const lessonsTotal = (learning ? (counts ?? learning.progress).total : 0) + teacherLessons

  return (
    <article className={`hub-card hub-card--class${active ? ' is-active' : ''}`} data-testid={`class-card-${row.enrollmentId}`}>
      {onSelect ? (
        <button type="button" className="hub-card__select" aria-pressed={active} aria-label={t('myClasses.card.select', { course: courseName })} onClick={onSelect} />
      ) : null}
      <div className="hub-card__top">
        <span className="hub-card__icon">{cover ? <img src={cover} alt="" referrerPolicy="no-referrer" decoding="async" /> : <ReadOutlined aria-hidden />}</span>
        {learning || teacherLessons > 0 ? (
          <span className="hub-card__badges">
            {subject ? (
              <span className="hub-badge hub-badge--kind" data-testid="class-card-subject">
                {subject}
              </span>
            ) : null}
            <span className="hub-badge hub-badge--kind" data-testid={`class-card-lessons-${row.enrollmentId}`}>
              <PlayCircleOutlined aria-hidden /> {t('myClasses.card.lessons', { total: lessonsTotal })}
            </span>
          </span>
        ) : null}
      </div>

      <h3 className="hub-card__name">{className}</h3>

      <p className="hub-card__teacher">
        <BookOutlined aria-hidden /> <span>{courseName}</span>
      </p>
      {showStudent ? (
        <p className="hub-card__teacher">
          <TeamOutlined aria-hidden /> <span>{displayNameOf(row.student)}</span>
          <span className={`hub-badge hub-badge--${row.relation === 'self' ? 'active' : 'recorded'} hub-badge--small`}>{t(`myClasses.relation.${row.relation}`)}</span>
        </p>
      ) : null}
      <p className="hub-card__teacher">
        <UserOutlined aria-hidden /> {row.class.leadTeacher ? displayNameOf(row.class.leadTeacher) : t('classes.noTeacher')}
      </p>

      {learning ? (
        <ClassProgress item={learning} counts={counts ?? learning.progress} classLessons={teacherLessons} />
      ) : learningLoading && hasClassLessons(row.enrollmentStatus) ? (
        <Skeleton.Input active size="small" block />
      ) : teacherLessons > 0 ? (
        <p className="hub-card__note">{t('myClasses.card.classLessons', { n: teacherLessons })}</p>
      ) : null}

      {/* «الشهادة» is always there (J-F68), so the row of actions always is. */}
      <div className="hub-card__actions">
        {onSelect ? (
          <button type="button" className="hub-card__browse" onClick={onSelect}>
            <UnorderedListOutlined aria-hidden /> {t('myClasses.card.browse')}
            <span className="hub-sr-only">: {courseName}</span>
          </button>
        ) : null}
        <ResourcesButton
          resources={materials}
          label={t('myClasses.card.materials')}
          labelMany={t('myClasses.card.materialsMany', { n: materials.length })}
          context={courseName}
          className="hub-btn--book"
          icon={<FilePdfOutlined aria-hidden />}
        />
        {certificateId ? (
          <a className="hub-btn hub-btn--certificate" href={myCertificatePrintPath(certificateId)} target="_blank" rel="noopener noreferrer">
            <SafetyCertificateOutlined aria-hidden /> {t('myClasses.card.certificate')}
            <span className="hub-sr-only">
              : {courseName} {t('mySchool.card.newTab')}
            </span>
          </a>
        ) : (
          <button type="button" className="hub-btn hub-btn--certificate is-locked" aria-haspopup="dialog" onClick={onShowCertificateGaps}>
            <LockOutlined aria-hidden /> {t('myClasses.card.certificate')}
            <span className="hub-sr-only">
              : {courseName} — {t('myClasses.card.certificateLocked')}
            </span>
          </button>
        )}
      </div>
    </article>
  )
}

/** The learner's progress in the course, as the cards of «دروسي» showed it: the server's counts and percent only. */
function ClassProgress({ item, counts, classLessons }: { item: MyLearningCourse; counts: ProgressCounts; classLessons: number }) {
  const { t } = useTranslation()
  if (counts.total === 0) {
    return (
      <p className="hub-card__note" data-testid={`class-progress-${item.enrollmentId}`}>
        {classLessons > 0 ? t('myClasses.card.classLessons', { n: classLessons }) : t('mySchool.card.noLessons')}
      </p>
    )
  }
  const percent = counts.percent ?? 0
  return (
    <div className="hub-progress" data-testid={`class-progress-${item.enrollmentId}`}>
      <div className="hub-progress__text">
        <span>{t('myClasses.card.progress')}</span>
        <span>
          <bdi dir="ltr">
            {counts.completed} / {counts.total}
          </bdi>{' '}
          ({t('learn.progress.percent', { percent })})
        </span>
      </div>
      <div className="hub-progress__bar" role="progressbar" aria-label={t('myClasses.card.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="hub-progress__fill" style={{ inlineSize: `${percent}%` }} />
      </div>
    </div>
  )
}
