// The lessons panel of one course (J-F64 in «دروسي»; since J-F67 under the cards of «دوراتي»): the level-by-level list
// with «الكل / المباشرة / المسجلة», and the opened lesson playing inside the page above it — the app's menu stays beside
// it. The opened lesson lives in the address (`?course=…&lesson=…`), so a reload keeps it and the browser's back
// closes it. The row and the player are shared with «دروسي» (`HubRow`, `HubPlayer` — J-F67); everything about a lesson
// is the course player's own: its content, completion, resources and neighbours (LessonView), API-230..234.
import { LockOutlined, PlayCircleFilled } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import type { MyLearningCourse, ProgressCounts } from '../../api/learning'
import { useLocalized } from '../../i18n/useLocalized'
import { localizedLabel } from '../../users/users.format'
import { accessFailureOf } from '../learn.errors'
import { levelName } from '../learn.format'
import { isItemAvailable, isSectionOpen, openingItemOf, placeOf } from '../learn.state'
import { LearnAccessNotice } from '../LearnAccessNotice'
import { useLearningWorkspace } from '../useLearningWorkspace'
import { HubPlayer } from './HubPlayer'
import { HubRow } from './HubRow'
import { scrollToStart } from './hub.scroll'
import { COURSE_PARAM, HUB_FILTERS, LESSON_PARAM, hubGroupsOf } from './hub.view'
import type { HubFilter } from './hub.view'

export interface HubLessonsProps {
  course: MyLearningCourse
  /** The course's counts as the server last answered them, for its card and the summary. */
  onProgress: (courseId: string, counts: ProgressCounts) => void
}

export function HubLessons({ course, onProgress }: HubLessonsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const courseId = course.course.id
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<HubFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  const shownCounts = workspace?.progress
  useEffect(() => {
    if (shownCounts) onProgress(courseId, shownCounts)
  }, [courseId, shownCounts, onProgress])

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
        <HubPlayer
          courseName={courseName}
          lessonId={lessonId}
          workspace={workspace}
          updateWorkspace={updateWorkspace}
          reloadWorkspace={reloadWorkspace}
          onOpen={openLesson}
          onClose={closeLesson}
          onNotice={setNotice}
          onBackToContents={() => {
            closeLesson()
            scrollToStart(listRef.current)
          }}
        />
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
                  <HubRow key={item.id} item={item} number={number} current={item.id === lessonId} opensOn={section.opensOn} onOpen={openLesson} onExamClosed={reloadWorkspace} />
                ))}
              </ol>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
