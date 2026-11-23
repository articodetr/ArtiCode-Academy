// «دروسي» for a student (J-F64), on the layout of «برامجي التعليمية»: a summary
// header, a card per course with its progress, and the chosen course's lessons
// below — the video plays inside the page, beside the app's fixed menu. API-229
// lists the courses; every count is the server's (D-R133).
import { BookOutlined, CheckCircleFilled, CheckSquareOutlined, PlayCircleOutlined, ReadOutlined, UnorderedListOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { MyLearningCourse, ProgressCounts } from '../../api/learning'
import { useLocalized } from '../../i18n/useLocalized'
import { isCourseDone, mySchoolFailureKey } from '../../mySchool/mySchool.view'
import { useMyLearning } from '../../mySchool/useMyLearning'
import { displayNameOf, localizedLabel } from '../../users/users.format'
import { isHttpsUrl } from '../learn.format'
import '../learn.css'
import './hub.css'
import { HubLessons } from './HubLessons'
import { COURSE_PARAM, LESSON_PARAM, cardPercent, countsOf, hubTotals, selectedCourseOf, studyCourses } from './hub.view'

export function MyLessonsHub({ tabs }: { tabs: ReactNode }) {
  const { t } = useTranslation()
  const learning = useMyLearning()
  const [params, setParams] = useSearchParams()
  const [live, setLive] = useState<Readonly<Record<string, ProgressCounts>>>({})
  const panelRef = useRef<HTMLDivElement>(null)
  const courses = studyCourses(learning.data ?? [])
  const selected = selectedCourseOf(courses, params.get(COURSE_PARAM))
  const totals = hubTotals(courses, live)

  const onProgress = useCallback((courseId: string, counts: ProgressCounts) => {
    setLive((previous) => (previous[courseId] === counts ? previous : { ...previous, [courseId]: counts }))
  }, [])

  const selectCourse = (courseId: string, reveal: boolean) => {
    if (courseId !== selected?.course.id) {
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set(COURSE_PARAM, courseId)
        next.delete(LESSON_PARAM)
        return next
      })
    }
    if (reveal) panelRef.current?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <div className="hub">
      {tabs}
      <header className="hub-header">
        <div className="hub-header__info">
          <h1 className="hub-header__title">
            <ReadOutlined aria-hidden /> {t('myLessons.hub.title')}
          </h1>
          <p className="hub-header__text">{t('myLessons.hub.description')}</p>
        </div>
        <div className="hub-stats">
          <Stat icon={<BookOutlined aria-hidden />} value={learning.data ? totals.courses : null} label={t('myLessons.hub.stats.courses')} />
          <Stat icon={<PlayCircleOutlined aria-hidden />} value={learning.data ? totals.lessons : null} label={t('myLessons.hub.stats.lessons')} />
          <Stat icon={<CheckSquareOutlined aria-hidden />} value={learning.data ? totals.completed : null} label={t('myLessons.hub.stats.completed')} />
        </div>
      </header>

      {learning.loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : learning.error ? (
        <Alert
          type="error"
          showIcon
          title={t(mySchoolFailureKey(learning.error))}
          action={
            <Button size="small" onClick={learning.retry}>
              {t('learn.load.retry')}
            </Button>
          }
        />
      ) : courses.length === 0 ? (
        <div className="hub-empty">
          <h3>{t('myLessons.hub.empty.title')}</h3>
          <p>{t('myLessons.hub.empty.text')}</p>
          <Link className="hub-btn hub-btn--play" to="/catalog">
            {t('myLessons.hub.empty.action')}
          </Link>
        </div>
      ) : (
        <>
          <div className="hub-section-head">
            <h2>{t('myLessons.hub.coursesTitle')}</h2>
            <p>{t('myLessons.hub.coursesHint')}</p>
          </div>
          <div className="hub-grid">
            {courses.map((item) => (
              <CourseCard
                key={item.course.id}
                item={item}
                counts={countsOf(item, live)}
                active={item.course.id === selected?.course.id}
                onSelect={(reveal) => selectCourse(item.course.id, reveal)}
              />
            ))}
          </div>
          <div ref={panelRef} className="hub-panel-anchor">{selected ? <HubLessons key={selected.course.id} course={selected} onProgress={onProgress} /> : null}</div>
        </>
      )}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number | null; label: string }) {
  return (
    <div className="hub-stat">
      {icon}
      <div>
        <strong className="hub-stat__value">{value ?? '—'}</strong>
        <span className="hub-stat__label">{label}</span>
      </div>
    </div>
  )
}

function CourseCard({ item, counts, active, onSelect }: { item: MyLearningCourse; counts: ProgressCounts; active: boolean; onSelect: (reveal: boolean) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const name = localizedLabel(item.course.name, language)
  const percent = cardPercent(counts)
  const done = isCourseDone({ progress: counts, enrollment: item.enrollment })
  const cover = isHttpsUrl(item.course.coverImageUrl) ? item.course.coverImageUrl : null

  return (
    <article className={`hub-card${active ? ' is-active' : ''}`}>
      <button type="button" className="hub-card__select" aria-pressed={active} aria-label={t('myLessons.hub.card.select', { course: name })} onClick={() => onSelect(false)} />
      <div className="hub-card__top">
        <span className="hub-card__icon">{cover ? <img src={cover} alt="" referrerPolicy="no-referrer" decoding="async" /> : <ReadOutlined aria-hidden />}</span>
        <span className="hub-card__badges">
          <span className={`hub-badge ${done ? 'hub-badge--done' : 'hub-badge--active'}`}>
            <CheckCircleFilled aria-hidden /> {t(done ? 'myLessons.hub.card.done' : 'myLessons.hub.card.active')}
          </span>
          <span className="hub-badge hub-badge--kind">
            <PlayCircleOutlined aria-hidden /> {t('myLessons.hub.card.lessons', { total: counts.total })}
          </span>
        </span>
      </div>
      <h3 className="hub-card__name">{name}</h3>
      {item.leadTeacher ? (
        <p className="hub-card__teacher">
          <UserOutlined aria-hidden /> {displayNameOf(item.leadTeacher)}
        </p>
      ) : null}
      {counts.total > 0 ? (
        <div className="hub-progress">
          <div className="hub-progress__text">
            <span>{t('myLessons.hub.card.progress')}</span>
            <span>
              <bdi dir="ltr">
                {counts.completed} / {counts.total}
              </bdi>{' '}
              ({t('learn.progress.percent', { percent })})
            </span>
          </div>
          <div className="hub-progress__bar" role="progressbar" aria-label={t('myLessons.hub.card.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="hub-progress__fill" style={{ inlineSize: `${percent}%` }} />
          </div>
        </div>
      ) : null}
      <button type="button" className="hub-card__browse" onClick={() => onSelect(true)}>
        <UnorderedListOutlined aria-hidden /> {t('myLessons.hub.card.browse')}
        <span className="learn-sr-only">: {name}</span>
      </button>
    </article>
  )
}
