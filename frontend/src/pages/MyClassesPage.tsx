// «My classes» (MOD-05 — J-F04): GET /api/me/classes (API-060) for a student
// (their own enrollments, `relation: self`) and a guardian (the enrollments of
// the students linked to them, `relation: child`, while they hold the
// `guardian` role — the server decides). Ownership, no permission key: the
// page shows exactly what the server returns — the class, its course and its
// lead teacher by name — and never contact fields, rosters or other students.
// `active` and `completed` enrollments (the server default).
// Since J-F61 (CH-0237) it is also the learner's way into their courses, in place of «مدرستي»: each enrollment carries
// the progress and the action of API-229 (joined on the enrollment id; a failed read never hides the classes).
// Since J-F67 (CH-0243) the classes are cards on the look of «دروسي» (J-F64/J-F66 — `learn/hub/hub.css`, Cairo and
// the scoped Ant Design theme) — one card per enrollment (`enrollments/MyClassCard.tsx`) — and nothing stands above
// them: no page title (the top menu names the page; a screen reader gets a hidden heading), no tabs, no status filter.
// A student's enrollment requests (API-222/223) open only from the links that ask for them, `?section=requests`
// (the catalog course page and the learning workspace's access notice), with a way back to the cards.
// Choosing a card of a course the learner studies (the card itself or its «استعراض الدروس») shows that course's lessons
// below the cards, on this page, and scrolls to them (Jallal's request — what «دروسي» did with its cards until J-F67):
// `learn/hub/HubLessons.tsx` — the levels, the «الكل / المباشرة / المسجلة» filter and the lesson playing inside the
// page. The chosen course and the opened lesson live in the address (`?course=…&lesson=…`), so a reload keeps them;
// without `?course=` no course is shown until one is chosen.
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { Alert, Button, ConfigProvider, Skeleton } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import type { ProgressCounts } from '../api/learning'
import { listMyCertificates } from '../api/myCertificates'
import { useAuth } from '../auth/auth-context'
import { useMyRequests } from '../catalog/useMyRequests'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { PageHeader } from '../components/PageHeader'
import { MyClassCard } from '../enrollments/MyClassCard'
import { MyEnrollmentRequests } from '../enrollments/MyEnrollmentRequests'
import { useMyClasses } from '../enrollments/useMyClasses'
import { HubLessons } from '../learn/hub/HubLessons'
import { HUB_ANTD_THEME } from '../learn/hub/hub.theme'
import { COURSE_PARAM, LESSON_PARAM, chosenCourseOf, countsOf, isStudyCourse, studyCourses } from '../learn/hub/hub.view'
import { SECTION_PARAM, mySchoolFailureKey } from '../mySchool/mySchool.view'
import { SourceAlert } from '../mySchool/SourceAlert'
import { useMyLearning } from '../mySchool/useMyLearning'
import '../publicCatalog/publicFonts.css'
import '../learn/learn.css'
import '../learn/hub/hub.css'

const REQUESTS_SECTION = 'requests'

export function MyClassesPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [params] = useSearchParams()
  // Only a student has requests of their own: API-222 would answer a guardian an empty list.
  const isStudent = user?.roles.includes('student') ?? false
  const showRequests = isStudent && params.get(SECTION_PARAM) === REQUESTS_SECTION
  const requests = useMyRequests(showRequests)
  const navigate = useNavigate()

  return (
    <ConfigProvider theme={HUB_ANTD_THEME}>
      <div className="hub-sessions">
        {showRequests ? (
          <section>
            <PageHeader
              title={t('myClasses.sections.requests')}
              extra={
                <Button icon={i18n.dir() === 'rtl' ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />} onClick={() => navigate('/my-classes')}>
                  {t('myClasses.classLessons.back')}
                </Button>
              }
            />
            <MyEnrollmentRequests source={requests} />
          </section>
        ) : (
          <MyClassCards />
        )}
      </div>
    </ConfigProvider>
  )
}

/**
 * The issued certificates of the caller's enrollments (API-135), by enrollment id — for «الشهادة» on a card (J-F67).
 * Read once; a failure or a missing key (403) just shows no certificate button.
 */
function useIssuedCertificates(): ReadonlyMap<string, string> {
  const [byEnrollment, setByEnrollment] = useState<ReadonlyMap<string, string>>(() => new Map())
  useEffect(() => {
    const controller = new AbortController()
    listMyCertificates({}, controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return
        setByEnrollment(new Map(list.items.filter((item) => item.status === 'issued').map((item) => [item.enrollmentId, item.id])))
      },
      () => undefined,
    )
    return () => controller.abort()
  }, [])
  return byEnrollment
}

/** Brings the chosen course's lessons into view, without the animation for a reader who asked for less motion. */
function scrollToStart(element: HTMLElement | null) {
  const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element?.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
}

function MyClassCards() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const my = useMyClasses()
  const learning = useMyLearning()
  const [live, setLive] = useState<Readonly<Record<string, ProgressCounts>>>({})
  const [reveal, setReveal] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const learningOf = new Map((learning.data ?? []).map((item) => [item.enrollmentId, item]))
  const certificateOf = useIssuedCertificates()
  const selected = chosenCourseOf(studyCourses(learning.data ?? []), params.get(COURSE_PARAM))
  // The student line matters only to a guardian (or whenever the server returned a child's enrollment).
  const showStudent = (user?.roles.includes('guardian') ?? false) || my.items.some((item) => item.relation === 'child')
  const failure = my.error ? describeClassesFailure(my.error) : null

  const onProgress = useCallback((courseId: string, counts: ProgressCounts) => {
    setLive((previous) => (previous[courseId] === counts ? previous : { ...previous, [courseId]: counts }))
  }, [])

  // After a choice the panel is on screen (possibly still loading): scroll to its start.
  useEffect(() => {
    if (reveal > 0) scrollToStart(panelRef.current)
  }, [reveal])

  const selectCourse = (courseId: string) => {
    if (courseId !== selected?.course.id) {
      setParams((previous) => {
        const next = new URLSearchParams(previous)
        next.set(COURSE_PARAM, courseId)
        next.delete(LESSON_PARAM)
        return next
      })
    }
    setReveal((count) => count + 1)
  }

  return (
    <section aria-busy={my.loading}>
      {/* The top menu names the page; the heading is for screen readers and the page outline only. */}
      <h1 className="hub-sr-only">{t('myClasses.title')}</h1>

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={my.reload}>
              {t('myClasses.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {learning.error ? (
        <div style={{ marginBottom: 16 }}>
          <SourceAlert title={t('myClasses.learningError')} description={t(mySchoolFailureKey(learning.error))} onRetry={learning.retry} />
        </div>
      ) : null}

      {my.loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : my.items.length > 0 ? (
        <div className="hub-grid">
          {my.items.map((row) => {
            const item = learningOf.get(row.enrollmentId) ?? null
            const choosable = item !== null && isStudyCourse(item)
            return (
              <MyClassCard
                key={row.enrollmentId}
                row={row}
                learning={item}
                counts={item ? countsOf(item, live) : null}
                learningLoading={learning.loading}
                showStudent={showStudent}
                onSelect={choosable ? () => selectCourse(item.course.id) : null}
                active={choosable && item.course.id === selected?.course.id}
                certificateId={certificateOf.get(row.enrollmentId) ?? null}
              />
            )
          })}
        </div>
      ) : failure ? null : (
        <div className="hub-empty">
          <p>{t('myClasses.empty')}</p>
        </div>
      )}

      <div ref={panelRef} className="hub-panel-anchor">
        {selected ? <HubLessons key={selected.course.id} course={selected} onProgress={onProgress} /> : null}
      </div>
    </section>
  )
}
