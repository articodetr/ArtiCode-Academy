// The lessons panel of one course in «دروسي» (J-F64): the level-by-level list
// with «الكل / المباشرة / المسجلة», and the opened lesson playing inside the page
// above it — the app's menu stays beside it. The opened lesson lives in the
// address (`?course=…&lesson=…`), so a reload keeps it and the browser's back
// closes it. Everything about a lesson is the course player's own: its content,
// completion, resources and neighbours (LessonView), API-230..234.
import { CheckCircleFilled, CloseOutlined, LockOutlined, PaperClipOutlined, PlayCircleFilled, VideoCameraOutlined } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAcademy } from '../../academy/useAcademy'
import { completeLearningItem } from '../../api/learning'
import type { ItemProgress, LearningWorkspace, MyLearningCourse, PlaybackResult, ProgressCounts, WorkspaceItem } from '../../api/learning'
import { useAuth } from '../../auth/auth-context'
import { academyTimeZoneOf } from '../../common/timeZone'
import { useLocalized } from '../../i18n/useLocalized'
import { formatDay, localizedLabel } from '../../users/users.format'
import { CourseDoneModal } from '../CourseDoneModal'
import { accessFailureOf } from '../learn.errors'
import { itemDurationLabel, levelName } from '../learn.format'
import { completesCourse, isItemAvailable, isSectionOpen, openingItemOf, placeOf, withItemProgress } from '../learn.state'
import type { CountsUpdate } from '../learn.state'
import { LearnAccessNotice } from '../LearnAccessNotice'
import { LessonView } from '../LessonView'
import { useLearningItem } from '../useLearningItem'
import { useLearningWorkspace } from '../useLearningWorkspace'
import { useWatchedPercent } from '../watched.store'
import { COURSE_PARAM, HUB_FILTERS, LESSON_PARAM, hubGroupsOf, rowActionOf } from './hub.view'
import { HubCompletion } from './HubCompletion'
import type { HubFilter } from './hub.view'

export interface HubLessonsProps {
  course: MyLearningCourse
  /** The course's counts as the server last answered them, for its card and the summary. */
  onProgress: (courseId: string, counts: ProgressCounts) => void
}

function scrollToStart(element: HTMLElement | null) {
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
}

export function HubLessons({ course, onProgress }: HubLessonsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const courseId = course.course.id
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<HubFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [courseDone, setCourseDone] = useState(false)
  const playerRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const finishRef = useRef<HTMLDivElement>(null)

  const reading = useLearningWorkspace(courseId)
  const { workspace, update: updateWorkspace, reload: reloadWorkspace } = reading

  const requested = params.get(LESSON_PARAM) ?? undefined
  const place = placeOf(workspace, requested)
  // Only a lesson of this course that can be opened today is ever read (the server would refuse the others).
  const lessonId = place && isItemAvailable(place.item) ? requested : undefined

  const openLesson = useCallback(
    (id: string) => {
      setNotice(null)
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set(COURSE_PARAM, courseId)
        next.set(LESSON_PARAM, id)
        return next
      })
    },
    [courseId, setParams],
  )
  const closeLesson = useCallback(
    (replace = false) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete(LESSON_PARAM)
          return next
        },
        { replace },
      )
    },
    [setParams],
  )

  const itemReading = useLearningItem(lessonId, {
    onVisited: (id, progress) => updateWorkspace((current) => withItemProgress(current, id, progress)),
    onGone: () => {
      setNotice(t('learn.notices.lessonUnavailable'))
      reloadWorkspace()
      closeLesson(true)
    },
    onLocked: (_id, opensOn) => {
      setNotice(opensOn ? t('learn.notices.levelNotOpen', { date: formatDay(opensOn, language) }) : t('learn.notices.levelNotOpenNoDate'))
      reloadWorkspace()
      closeLesson(true)
    },
  })
  const { setProgress } = itemReading

  const workspaceRef = useRef<LearningWorkspace | null>(workspace)
  useLayoutEffect(() => {
    workspaceRef.current = workspace
  })

  const shownCounts = workspace?.progress
  useEffect(() => {
    if (shownCounts) onProgress(courseId, shownCounts)
  }, [courseId, shownCounts, onProgress])

  useEffect(() => {
    if (lessonId) scrollToStart(playerRef.current)
  }, [lessonId])

  const applyAnswer = useCallback(
    (id: string, progress: ItemProgress, counts: CountsUpdate, completedNow: boolean) => {
      const before = workspaceRef.current?.progress
      setProgress(id, progress)
      updateWorkspace((current) => withItemProgress(current, id, progress, counts))
      if (before && completesCourse(before, counts.course, completedNow)) setCourseDone(true)
      if (completedNow) reloadWorkspace()
    },
    [setProgress, updateWorkspace, reloadWorkspace],
  )
  const completeItem = useCallback(
    async (id: string) => {
      const result = await completeLearningItem(id)
      applyAnswer(id, result.progress, { section: result.section, course: result.course }, result.completedNow)
    },
    [applyAnswer],
  )
  const playbackSaved = useCallback(
    (id: string, result: PlaybackResult) => applyAnswer(id, result.progress, { course: result.course }, result.completedNow),
    [applyAnswer],
  )

  const shownLessonRef = useRef<string | null>(null)
  const shouldFocus = useCallback((id: string) => {
    const previous = shownLessonRef.current
    shownLessonRef.current = id
    return previous !== null && previous !== id
  }, [])

  const access = workspace === null ? accessFailureOf(reading.error, 'course') : null
  const courseName = localizedLabel(course.course.name, language)
  const groups = workspace ? hubGroupsOf(workspace, filter) : []
  const resumeId = workspace ? openingItemOf(workspace) : null
  const started = course.lastLesson !== null || (workspace?.progress.completed ?? 0) > 0

  return (
    <section className="hub-panel" aria-label={t('myLessons.hub.panel.label', { course: courseName })}>
      <div className="hub-panel__head">
        <div>
          <h2 className="hub-panel__title">
            <span>{t('myLessons.hub.panel.title')}</span> <span className="hub-gold">{courseName}</span>
          </h2>
          <p className="hub-panel__hint">{t('myLessons.hub.panel.hint')}</p>
        </div>
        <div className="hub-panel__tools">
          {resumeId && resumeId !== lessonId ? (
            <button type="button" className="hub-btn hub-btn--play" onClick={() => openLesson(resumeId)}>
              <PlayCircleFilled aria-hidden /> {t(started ? 'myLessons.hub.panel.resume' : 'myLessons.hub.panel.start')}
            </button>
          ) : null}
          <div className="hub-pills" role="group" aria-label={t('myLessons.hub.filters.label')}>
            {HUB_FILTERS.map((value) => (
              <button key={value} type="button" className={`hub-pill${filter === value ? ' is-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {t(`myLessons.hub.filters.${value}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {notice ? <Alert className="hub-notice" type="info" showIcon closable onClose={() => setNotice(null)} title={notice} /> : null}

      {lessonId ? (
        <section className="hub-player" ref={playerRef} aria-label={t('myLessons.hub.player.label')}>
          <div className="hub-player__head">
            <span className="hub-gold">{courseName}</span>
            <Button icon={<CloseOutlined aria-hidden />} onClick={() => closeLesson()}>
              {t('myLessons.hub.player.close')}
            </Button>
          </div>
          {itemReading.loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : itemReading.item ? (
            <LessonView
              key={itemReading.item.id}
              item={itemReading.item}
              onComplete={completeItem}
              onPlayback={playbackSaved}
              onNavigate={openLesson}
              onBackToContents={() => {
                closeLesson()
                scrollToStart(listRef.current)
              }}
              shouldFocus={shouldFocus}
              examZone={academyTimeZoneOf(academy) ?? undefined}
            />
          ) : itemReading.error ? (
            <Alert
              type="error"
              showIcon
              title={t('learn.load.lessonError')}
              action={
                <Button size="small" onClick={itemReading.retry}>
                  {t('learn.load.retry')}
                </Button>
              }
            />
          ) : null}
        </section>
      ) : null}

      <div ref={listRef} className="hub-list-anchor">
        {access ? (
          <LearnAccessNotice failure={access} courseId={courseId} />
        ) : workspace === null ? (
          reading.loading ? (
            <Skeleton active paragraph={{ rows: 5 }} />
          ) : (
            <Alert
              type="error"
              showIcon
              title={t('learn.load.courseError')}
              action={
                <Button size="small" onClick={reloadWorkspace}>
                  {t('learn.load.retry')}
                </Button>
              }
            />
          )
        ) : groups.length === 0 ? (
          <div className="hub-empty">
            <h3>{t(workspace.sections.some((section) => section.items.length > 0) ? 'myLessons.hub.emptyFilter' : 'myLessons.hub.emptyCourse')}</h3>
          </div>
        ) : (
          groups.map(({ section, rows }) => (
            <div key={section.id ?? 'loose'} className="hub-level">
              {workspace.sections.length > 1 || section.title ? (
                <h3 className="hub-level__title">
                  {!isSectionOpen(section) ? <LockOutlined aria-hidden /> : null} {levelName(section, t, language)}
                </h3>
              ) : null}
              <ol className="hub-list">
                {rows.map(({ item, number }) => (
                  <HubRow key={item.id} item={item} number={number} current={item.id === lessonId} opensOn={section.opensOn} onOpen={openLesson} />
                ))}
              </ol>
            </div>
          ))
        )}
      </div>
      <div ref={finishRef} className="hub-finish-anchor">
        <HubCompletion course={course} version={workspace?.progress.completedRequired ?? 0} />
      </div>
      <CourseDoneModal
        open={courseDone}
        onClose={() => setCourseDone(false)}
        next={{
          label: t('myLessons.hub.finish.goToExams'),
          onClick: () => {
            setCourseDone(false)
            scrollToStart(finishRef.current)
          },
        }}
      />
    </section>
  )
}

function HubRow({ item, number, current, opensOn, onOpen }: { item: WorkspaceItem; number: number; current: boolean; opensOn: string | null; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user } = useAuth()
  const watched = useWatchedPercent(user?.id, item.id)
  const available = isItemAvailable(item)
  const completed = item.state === 'completed'
  const action = rowActionOf(item)
  const duration = itemDurationLabel(item, t)
  const live = item.kind === 'live'
  const showWatched = !completed && watched !== null && watched > 0

  return (
    <li className={`hub-row${current ? ' is-current' : ''}${available ? '' : ' is-locked'}`} aria-current={current ? 'true' : undefined}>
      <span className="hub-row__number" aria-hidden>
        {completed ? <CheckCircleFilled /> : number}
      </span>
      <div className="hub-row__main">
        <div className="hub-row__badges">
          {live || item.kind === 'video' ? (
            <span className={`hub-badge ${live ? 'hub-badge--live' : 'hub-badge--recorded'}`}>
              {live ? <VideoCameraOutlined aria-hidden /> : <PlayCircleFilled aria-hidden />} {t(live ? 'myLessons.hub.row.live' : 'myLessons.hub.row.recorded')}
            </span>
          ) : (
            <span className="hub-badge hub-badge--kind">{t(`learn.kinds.${item.kind}`)}</span>
          )}
          {completed ? (
            <span className="hub-badge hub-badge--done">
              <CheckCircleFilled aria-hidden /> {t('myLessons.hub.row.completed')}
            </span>
          ) : item.state === 'in_progress' ? (
            <span className="hub-badge hub-badge--progress">{t('myLessons.hub.row.inProgress')}</span>
          ) : null}
          {item.isRequired ? null : <span className="hub-badge hub-badge--kind">{t('learn.lesson.optional')}</span>}
        </div>
        <h4 className="hub-row__title">
          <span className="learn-sr-only">{number}. </span>
          {localizedLabel(item.title, language)}
        </h4>
        <div className="hub-row__meta">
          {duration ? <span>{duration.clock ? <bdi dir="ltr">{duration.text}</bdi> : duration.text}</span> : null}
          {item.kind === 'file' || item.kind === 'pdf' ? (
            <span>
              <PaperClipOutlined aria-hidden /> {t('myLessons.hub.row.attachment')}
            </span>
          ) : null}
        </div>
        {showWatched ? (
          <div className="hub-row__watch">
            <div className="hub-row__track" role="progressbar" aria-label={t('learn.lesson.watch.label')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={watched}>
              <div className="hub-row__fill" style={{ inlineSize: `${watched}%` }} />
            </div>
            <span>{t('learn.lesson.watch.percent', { percent: watched })}</span>
          </div>
        ) : null}
      </div>
      <div className="hub-row__actions">
        {!available ? (
          <span className="hub-locked">
            <LockOutlined aria-hidden /> {opensOn ? t('myLessons.hub.row.opensOn', { date: formatDay(opensOn, language) }) : t('myLessons.hub.row.locked')}
          </span>
        ) : current ? (
          <span className="hub-playing">{t('myLessons.hub.row.playing')}</span>
        ) : (
          <button type="button" className={`hub-btn ${action === 'play' ? 'hub-btn--play' : 'hub-btn--open'}`} onClick={() => onOpen(item.id)}>
            {action === 'play' ? <PlayCircleFilled aria-hidden /> : null} {t(`myLessons.hub.row.${action}`)}
            <span className="learn-sr-only">: {localizedLabel(item.title, language)}</span>
          </button>
        )}
      </div>
    </li>
  )
}
