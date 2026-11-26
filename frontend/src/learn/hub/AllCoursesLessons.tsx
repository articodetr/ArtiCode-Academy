// «دروسي» for a student since J-F67 (Jallal's requests: the look of «دوراتي» exactly, and «لا اريد كل دورة لحالها
// اريد ان يكونوا بالترتيب حسب النشر ويظهر في مكان اسم الدورة»): the summary header, then ONE lessons panel holding
// the lessons of every course the learner studies, newest first by the day each was added to its curriculum (API-230
// `createdAt` — not the day it was published: a draft published later keeps the day it was written), each row naming
// its course and level where a course's panel names its course. The rows and the in-page player are those of a
// course's panel in «دوراتي» (`HubRow`, `HubPlayer`); the opened lesson lives in the address (`?course=…&lesson=…`).
// Each course's workspace is read by its own `CourseSource` (the course player's `useLearningWorkspace`), so progress
// answers land in the right course. Every count is the server's (D-R133).
import { PlayCircleFilled } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import type { LearningWorkspace, MyLearningCourse, ProgressCounts } from '../../api/learning'
import { useLocalized } from '../../i18n/useLocalized'
import { mySchoolFailureKey } from '../../mySchool/mySchool.view'
import { useMyLearning } from '../../mySchool/useMyLearning'
import { localizedLabel } from '../../users/users.format'
import { levelName } from '../learn.format'
import { isItemAvailable, openingItemOf } from '../learn.state'
import { useLearningWorkspace } from '../useLearningWorkspace'
import type { WorkspaceReading } from '../useLearningWorkspace'
import '../learn.css'
import './hub.css'
import { HubPlayer } from './HubPlayer'
import { HubRow } from './HubRow'
import { HubSummary } from './HubSummary'
import { COURSE_PARAM, HUB_FILTERS, LESSON_PARAM, mergedLessonsOf, studyCourses } from './hub.view'
import type { HubFilter } from './hub.view'

type Source = Pick<WorkspaceReading, 'workspace' | 'loading' | 'error' | 'reload' | 'update'>

/** Reads one course's workspace and hands it to the list; renders nothing. */
function CourseSource({ courseId, onReading }: { courseId: string; onReading: (courseId: string, source: Source) => void }) {
  const { workspace, loading, error, reload, update } = useLearningWorkspace(courseId)
  useEffect(() => {
    onReading(courseId, { workspace, loading, error, reload, update })
  }, [courseId, workspace, loading, error, reload, update, onReading])
  return null
}

export function AllCoursesLessons() {
  const { t } = useTranslation()
  const learning = useMyLearning()
  const courses = useMemo(() => (learning.data ? studyCourses(learning.data) : null), [learning.data])
  const [sources, setSources] = useState<Readonly<Record<string, Source>>>({})

  const onReading = useCallback((courseId: string, source: Source) => {
    setSources((previous) => ({ ...previous, [courseId]: source }))
  }, [])

  // The summary follows the panel's latest answers, as a course's panel feeds it in «دوراتي».
  const live: Record<string, ProgressCounts> = {}
  for (const [courseId, source] of Object.entries(sources)) if (source.workspace) live[courseId] = source.workspace.progress

  return (
    <>
      <HubSummary courses={courses} live={live} />
      {(courses ?? []).map((course) => (
        <CourseSource key={course.course.id} courseId={course.course.id} onReading={onReading} />
      ))}

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
      ) : !courses || courses.length === 0 ? (
        <div className="hub-empty">
          <h3>{t('myLessons.hub.empty.title')}</h3>
          <p>{t('myLessons.hub.empty.text')}</p>
          <Link className="hub-btn hub-btn--play" to="/catalog">
            {t('myLessons.hub.empty.action')}
          </Link>
        </div>
      ) : (
        <AllLessonsPanel courses={courses} sources={sources} />
      )}
    </>
  )
}

function AllLessonsPanel({ courses, sources }: { courses: readonly MyLearningCourse[]; sources: Readonly<Record<string, Source>> }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<HubFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)

  const loaded: { course: MyLearningCourse; workspace: LearningWorkspace }[] = []
  for (const course of courses) {
    const workspace = sources[course.course.id]?.workspace
    if (workspace) loaded.push({ course, workspace })
  }
  const rows = mergedLessonsOf(loaded, filter)
  const all = filter === 'all' ? rows : mergedLessonsOf(loaded, 'all')
  const pending = courses.some((course) => !sources[course.course.id] || sources[course.course.id]!.loading)
  const failed = courses.filter((course) => {
    const source = sources[course.course.id]
    return source !== undefined && source.workspace === null && !source.loading && source.error !== null
  })

  // The opened lesson: the one the address names, of a course on the list, when it can be opened today.
  const requested = params.get(LESSON_PARAM)
  const opened = requested ? all.find((row) => row.item.id === requested && isItemAvailable(row.item)) ?? null : null
  const openedSource = opened ? sources[opened.course.course.id] : undefined

  // «تابع من حيث توقفت» resumes the course the learner was on last (the first of the list's courses).
  const first = loaded[0] ?? null
  const resumeId = first ? openingItemOf(first.workspace) : null

  const openLesson = useCallback(
    (courseId: string, id: string) => {
      setNotice(null)
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set(COURSE_PARAM, courseId)
        next.set(LESSON_PARAM, id)
        return next
      })
    },
    [setParams],
  )
  const closeLesson = useCallback(
    (replace = false) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.delete(LESSON_PARAM)
          next.delete(COURSE_PARAM)
          return next
        },
        { replace },
      )
    },
    [setParams],
  )

  return (
    <section className="hub-panel" aria-label={t('myLessons.feed.title')}>
      <div className="hub-panel__head">
        <div>
          <h2 className="hub-panel__title">{t('myLessons.feed.title')}</h2>
          <p className="hub-panel__hint">{t('myLessons.feed.allHint')}</p>
        </div>
        <div className="hub-panel__tools">
          {first && resumeId && resumeId !== opened?.item.id ? (
            <button type="button" className="hub-btn hub-btn--play" onClick={() => openLesson(first.course.course.id, resumeId)}>
              <PlayCircleFilled aria-hidden /> {t('myLessons.hub.panel.resume')}
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

      {opened && openedSource ? (
        <HubPlayer
          key={opened.course.course.id}
          course={opened.course}
          lessonId={opened.item.id}
          workspace={openedSource.workspace}
          updateWorkspace={openedSource.update}
          reloadWorkspace={openedSource.reload}
          onOpen={(id) => openLesson(opened.course.course.id, id)}
          onClose={closeLesson}
          onNotice={setNotice}
        />
      ) : null}

      {failed.length > 0 ? (
        <Alert
          type="error"
          showIcon
          title={t('myLessons.feed.someFailed', { courses: failed.map((course) => localizedLabel(course.course.name, language)).join('، ') })}
          action={
            <Button size="small" onClick={() => failed.forEach((course) => sources[course.course.id]?.reload())}>
              {t('learn.load.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <div className="hub-list-anchor">
        {rows.length === 0 ? (
          pending ? (
            <Skeleton active paragraph={{ rows: 5 }} />
          ) : failed.length === courses.length ? null : (
            <div className="hub-empty">
              <h3>{t(filter === 'all' ? 'myLessons.feed.emptyAll' : 'myLessons.feed.emptyFilter')}</h3>
            </div>
          )
        ) : (
          <ol className="hub-list">
            {rows.map(({ course, section, item }, index) => (
              <HubRow
                key={`${course.course.id}:${item.id}`}
                item={item}
                number={index + 1}
                current={item.id === opened?.item.id}
                opensOn={section.opensOn}
                onOpen={(id) => openLesson(course.course.id, id)}
                origin={`${localizedLabel(course.course.name, language)} · ${levelName(section, t, language)}`}
                onExamClosed={sources[course.course.id]?.reload}
              />
            ))}
          </ol>
        )}
        {pending && rows.length > 0 ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
      </div>
    </section>
  )
}
