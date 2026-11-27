// The lessons panel of one course (J-F64 in «دروسي»; since J-F67 under the cards of «دوراتي»): the level-by-level list
// with «الكل / المباشرة / المسجلة», and the opened lesson playing inside the page above it — the app's menu stays beside
// it. The opened lesson lives in the address (`?course=…&lesson=…`), so a reload keeps it and the browser's back
// closes it. The row and the player are shared with «دروسي» (`HubRow`, `HubPlayer` — J-F67); everything about a lesson
// is the course player's own: its content, completion, resources and neighbours (LessonView), API-230..234.
// Since J-F68 the panel ends with «اختبارات الدورة» (`CourseExams`): every exam of the class and where it stands, so the
// learner sees here what they have not taken or passed yet; an exam popup closed anywhere in the panel reads the lessons
// and the exams again and tells the page (`onExamClosed` — a certificate may have been issued).
// Since J-F81 (Jallal's request «اي درس ينشره الاستاذ يوصل مباشرة للطلاب») the panel opens with «دروس الفصل»: the
// lessons the class's teacher adds (MOD-06, API-101 — read by the page for every card, `classLessons`), newest first,
// each with its join link, video, exam and attachments beside each other (`MyLessonRow` — the exams are the class's,
// read once here for «اختبارات الدورة» too), narrowed by the same pills; the curriculum (MOD-20)
// follows under «منهج الدورة», and «لا توجد دروس» shows only when both are empty.
import { LockOutlined, PlayCircleFilled } from '@ant-design/icons'
import { Alert, Button, Skeleton } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import type { MyLearningCourse, ProgressCounts } from '../../api/learning'
import type { MyLessonItem } from '../../api/myLessons'
import { useLoad } from '../../dashboard/useLoad'
import { useLocalized } from '../../i18n/useLocalized'
import { MyLessonRow } from '../../lessons/MyLessonRow'
import { myLessonKey } from '../../lessons/myLessons.view'
import { localizedLabel } from '../../users/users.format'
import { accessFailureOf } from '../learn.errors'
import { levelName } from '../learn.format'
import { isItemAvailable, isSectionOpen, openingItemOf, placeOf } from '../learn.state'
import { LearnAccessNotice } from '../LearnAccessNotice'
import { useLearningWorkspace } from '../useLearningWorkspace'
import { CourseExams } from './CourseExams'
import { HubPlayer } from './HubPlayer'
import { HubRow } from './HubRow'
import { readClassExams } from './classExams'
import { lessonExamsOf, matchesLessonFilter } from './classLessons.view'
import { COURSE_PARAM, HUB_FILTERS, LESSON_PARAM, hubGroupsOf } from './hub.view'
import type { HubFilter } from './hub.view'

export interface HubLessonsProps {
  course: MyLearningCourse
  /** The course's counts as the server last answered them, for its card and the summary. */
  onProgress: (courseId: string, counts: ProgressCounts) => void
  /** Changes when the learner asked to see the course's exams (the window of «الشهادة»); 0 = never asked. */
  examsFocus?: number
  /** An exam popup of the panel closed: the page may read the certificates again. */
  onExamClosed?: () => void
  /** J-F81: the class lessons of this enrollment (API-101), newest first; absent = the panel shows the curriculum only. */
  classLessons?: HubClassLessons
}

/** The newest class lessons shown before «عرض كل دروس الفصل», so the curriculum stays near. */
export const CLASS_LESSONS_SHOWN = 6

export interface HubClassLessons {
  items: readonly MyLessonItem[]
  /** No answer yet: the first read is on its way. */
  pending: boolean
  /** The last read failed. */
  failed: boolean
  onRetry: () => void
}

export function HubLessons({ course, onProgress, examsFocus = 0, onExamClosed, classLessons }: HubLessonsProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const courseId = course.course.id
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<HubFilter>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [showAllClass, setShowAllClass] = useState(false)

  const reading = useLearningWorkspace(courseId)
  const { workspace, update: updateWorkspace, reload: reloadWorkspace } = reading
  const [examsRefresh, setExamsRefresh] = useState(0)
  // J-F81: the class's exams, read once for «اختبارات الدورة» and the class lessons' «الاختبار» (each lesson its own).
  const classId = course.class.id
  const studentId = course.student.id
  const classExams = useLoad(`courseExams:${classId}:${studentId}:${examsRefresh}`, true, (signal) => readClassExams(classId, studentId, signal))
  // An exam taken from a lesson row or from «اختبارات الدورة»: the rows' «تم الاختبار», the exams and the card follow.
  const examClosed = useCallback(() => {
    reloadWorkspace()
    setExamsRefresh((value) => value + 1)
    onExamClosed?.()
  }, [reloadWorkspace, onExamClosed])
  // An exam taken from the lesson popup (J-F69): the player reads the lessons again itself; the exams and the card follow.
  const playerExamClosed = useCallback(() => {
    setExamsRefresh((value) => value + 1)
    onExamClosed?.()
  }, [onExamClosed])

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
  const classRows = classLessons ? classLessons.items.filter((item) => matchesLessonFilter(item, filter)) : []
  const shownClassRows = showAllClass ? classRows : classRows.slice(0, CLASS_LESSONS_SHOWN)
  const hasClassLessons = (classLessons?.items.length ?? 0) > 0
  // Under «دروس الفصل» the curriculum gets its own heading, so its rows are never read as the class's.
  const curriculumHeading = classRows.length > 0 && groups.length > 0

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
          course={course}
          lessonId={lessonId}
          workspace={workspace}
          updateWorkspace={updateWorkspace}
          reloadWorkspace={reloadWorkspace}
          onOpen={openLesson}
          onClose={closeLesson}
          onNotice={setNotice}
          onExamClosed={playerExamClosed}
        />
      ) : null}

      <div className="hub-list-anchor">
        {classLessons?.failed ? (
          <Alert
            className="hub-notice"
            type="warning"
            showIcon
            title={t('myLessons.hub.classLessons.failed')}
            action={
              <Button size="small" onClick={classLessons.onRetry}>
                {t('learn.load.retry')}
              </Button>
            }
          />
        ) : null}
        {classRows.length > 0 ? (
          <div className="hub-level" data-testid="hub-class-lessons">
            <h3 className="hub-level__title">{t('myLessons.hub.classLessons.title')}</h3>
            <ol className="hub-list">
              {shownClassRows.map((item) => (
                <MyLessonRow
                  key={myLessonKey(item)}
                  item={item}
                  showStudent={false}
                  showClass={false}
                  exams={lessonExamsOf(classExams.data ?? [], item.id)}
                  onExamClosed={examClosed}
                />
              ))}
            </ol>
            {classRows.length > CLASS_LESSONS_SHOWN ? (
              <button type="button" className="hub-btn hub-btn--open hub-class-more" aria-expanded={showAllClass} onClick={() => setShowAllClass((value) => !value)}>
                {showAllClass ? t('myLessons.hub.classLessons.less') : t('myLessons.hub.classLessons.all', { n: classRows.length })}
              </button>
            ) : null}
          </div>
        ) : null}
        {curriculumHeading ? <h3 className="hub-level__title hub-level__title--curriculum">{t('myLessons.hub.classLessons.curriculum')}</h3> : null}
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
          // The class lessons fill the panel, or are still on their way: no «no lessons» message under them.
          classRows.length > 0 ? null : classLessons?.pending ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : (
            <div className="hub-empty">
              <h3>{t(hasClassLessons || workspace.sections.some((section) => section.items.length > 0) ? 'myLessons.hub.emptyFilter' : 'myLessons.hub.emptyCourse')}</h3>
            </div>
          )
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
                  <HubRow key={item.id} item={item} number={number} current={item.id === lessonId} opensOn={section.opensOn} onOpen={openLesson} onExamClosed={examClosed} />
                ))}
              </ol>
            </div>
          ))
        )}
        {workspace !== null && !access ? (
          <CourseExams classId={classId} studentId={studentId} own={course.relation === 'self'} refresh={examsRefresh} focus={examsFocus} onClosed={examClosed} source={classExams} />
        ) : null}
      </div>
    </section>
  )
}
