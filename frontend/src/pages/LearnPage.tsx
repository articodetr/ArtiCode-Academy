// The course player of «My School» (MOD-20, roadmap §4q — D-R130..D-R136):
// /learn/:courseId opens the course where the learner stopped (API-230
// `resume`), /learn/:courseId/:itemId one of its lessons (API-231). Outside
// the app layout: a focused header (brand, back to «مدرستي», breadcrumb, the
// course progress), the curriculum at the start side (a drawer below 992 px)
// and the lesson. The two routes render this one component, so moving between
// lessons keeps the workspace on screen — it is read again only after a
// completion. Every progress shown is the server's (D-R133): the answers of
// API-232..234 move the sidebar, the level and the course at once, and the
// «course complete» confirmation follows the server's word alone.
import { Alert, Button, Drawer, Skeleton } from 'antd'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { completeLearningItem } from '../api/learning'
import type { ItemProgress, LearningWorkspace, PlaybackResult } from '../api/learning'
import { academyTimeZoneOf } from '../common/timeZone'
import { useLocalized } from '../i18n/useLocalized'
import { CourseDoneModal } from '../learn/CourseDoneModal'
import { CurriculumNav } from '../learn/CurriculumNav'
import { accessFailureOf, isLessonGone } from '../learn/learn.errors'
import { levelName } from '../learn/learn.format'
import { completesCourse, openingItemOf, placeOf, sectionKeyOf, withItemProgress } from '../learn/learn.state'
import type { CountsUpdate } from '../learn/learn.state'
import { LearnAccessNotice } from '../learn/LearnAccessNotice'
import { LearnHeader } from '../learn/LearnHeader'
import { LessonView } from '../learn/LessonView'
import { useLearningItem } from '../learn/useLearningItem'
import { useLearningWorkspace } from '../learn/useLearningWorkspace'
import { useLevelToggles } from '../learn/useLevelToggles'
import { useNarrowScreen } from '../learn/useNarrowScreen'
import { localizedLabel } from '../users/users.format'
import '../learn/learn.css'

type NoticeKind = 'replaced' | 'lessonUnavailable'

/** The notice a redirect hands to the lesson it opens (router state), or null. */
function noticeOf(state: unknown): NoticeKind | null {
  if (typeof state !== 'object' || state === null || !('learnNotice' in state)) return null
  const value = (state as { learnNotice: unknown }).learnNotice
  return value === 'replaced' || value === 'lessonUnavailable' ? value : null
}

const SIDEBAR_HEADING = 'learn-curriculum-heading'
const DRAWER_HEADING = 'learn-curriculum-drawer-heading'

function coursePath(courseId: string): string {
  return `/learn/${encodeURIComponent(courseId)}`
}

function lessonPath(courseId: string, itemId: string): string {
  return `${coursePath(courseId)}/${encodeURIComponent(itemId)}`
}

export function LearnPage() {
  const { courseId = '', itemId } = useParams<{ courseId: string; itemId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { language } = useLocalized()
  const narrow = useNarrowScreen()
  const { academy } = useAcademy()
  const examZone = academyTimeZoneOf(academy) ?? undefined

  const workspaceReading = useLearningWorkspace(courseId)
  const { workspace, update: updateWorkspace, reload: reloadWorkspace } = workspaceReading
  // Lessons this visit found gone (API-231 404): never opened again, never a resume target.
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [courseDone, setCourseDone] = useState(false)

  const itemReading = useLearningItem(itemId && !missing.has(itemId) ? itemId : undefined, {
    onVisited: (id, progress) => updateWorkspace((current) => withItemProgress(current, id, progress)),
    onGone: (id) => {
      setMissing((previous) => new Set(previous).add(id))
      // The lesson was unpublished or removed: read the curriculum afresh, then open the resume target.
      reloadWorkspace()
      navigate(coursePath(courseId), { replace: true, state: { learnNotice: 'lessonUnavailable' } })
    },
  })
  const { setProgress } = itemReading

  // A notice handed over by a redirect shows once, on the lesson it opened (the router state is then cleared).
  const incoming = noticeOf(location.state)
  const [notice, setNotice] = useState<{ kind: NoticeKind; itemId: string } | null>(null)
  const [seenLocation, setSeenLocation] = useState<string | null>(null)
  if (itemId && incoming && location.key !== seenLocation) {
    setSeenLocation(location.key)
    setNotice({ kind: incoming, itemId })
  }
  useEffect(() => {
    if (itemId && incoming) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [itemId, incoming, location.pathname, location.search, navigate])

  const workspaceRef = useRef<LearningWorkspace | null>(workspace)
  useLayoutEffect(() => {
    workspaceRef.current = workspace
  })

  /** One answer of the server about one lesson, carried into the lesson, its level, the course and the sidebar. */
  const applyAnswer = useCallback(
    (id: string, progress: ItemProgress, counts: CountsUpdate, completedNow: boolean) => {
      const before = workspaceRef.current?.progress
      setProgress(id, progress)
      updateWorkspace((current) => withItemProgress(current, id, progress, counts))
      if (before && completesCourse(before, counts.course, completedNow)) setCourseDone(true)
      // Read the workspace again after a completion (the resume target, a playback level's counts).
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

  // The heading of a lesson takes the focus when the learner came from another lesson (not on arrival).
  const shownLessonRef = useRef<string | null>(null)
  const shouldFocus = useCallback((id: string) => {
    const previous = shownLessonRef.current
    shownLessonRef.current = id
    return previous !== null && previous !== id
  }, [])

  const place = placeOf(workspace, itemId)
  const toggles = useLevelToggles(courseId, place ? sectionKeyOf(place.section) : null)
  const sidebarRef = useRef<HTMLElement>(null)

  const backToContents = () => {
    if (narrow) {
      setDrawerOpen(true)
      return
    }
    const sidebar = sidebarRef.current
    const current = sidebar?.querySelector<HTMLElement>('[aria-current="page"]')
    ;(current ?? sidebar)?.focus()
  }

  // --- Refusals that replace the page -----------------------------------------
  const access = (workspace === null ? accessFailureOf(workspaceReading.error, 'course') : null) ?? accessFailureOf(itemReading.error, 'lesson')
  if (access) {
    return (
      <div className="learn-page learn-access-page">
        <LearnHeader />
        <main className="learn-main">
          <div className="learn-main__inner">
            <LearnAccessNotice failure={access} courseId={courseId} />
          </div>
        </main>
      </div>
    )
  }

  if (itemId && missing.has(itemId)) return <Navigate to={coursePath(courseId)} replace state={{ learnNotice: 'lessonUnavailable' }} />

  // --- No workspace yet ---------------------------------------------------------
  if (workspace === null) {
    return (
      <div className="learn-page">
        <LearnHeader />
        <main className="learn-main">
          <div className="learn-main__inner">
            {workspaceReading.loading ? (
              <Skeleton active paragraph={{ rows: 8 }} />
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
            )}
          </div>
        </main>
      </div>
    )
  }

  // --- /learn/:courseId — open where the learner stopped ------------------------
  if (!itemId && workspaceReading.settled) {
    const target = openingItemOf(workspace, missing)
    if (target) {
      const forward = incoming ?? (workspace.resume?.reason === 'replaced' && workspace.resume.itemId === target ? 'replaced' : null)
      return <Navigate to={lessonPath(courseId, target)} replace state={forward ? { learnNotice: forward } : undefined} />
    }
  }

  const item = itemReading.item
  const courseName = localizedLabel(workspace.course.name, language)
  const section = place?.section ?? item?.section ?? null
  const lessonTitle = item ? localizedLabel(item.title, language) : place ? localizedLabel(place.item.title, language) : null
  const trail = [courseName, ...(section ? [levelName(section, t, language)] : []), ...(lessonTitle ? [lessonTitle] : [])]
  const shownNotice = notice !== null && notice.itemId === itemId ? notice.kind : null
  const noLessons = !itemId && workspaceReading.settled

  let main
  if (noLessons) {
    main = <Alert type="info" showIcon title={t('learn.access.noLessons')} />
  } else if (!itemId || itemReading.loading || isLessonGone(itemReading.error)) {
    main = <Skeleton active paragraph={{ rows: 8 }} />
  } else if (itemReading.error) {
    main = (
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
    )
  } else if (item) {
    main = (
      <LessonView
        key={item.id}
        item={item}
        onComplete={completeItem}
        onPlayback={playbackSaved}
        onNavigate={(id) => navigate(lessonPath(courseId, id))}
        onBackToContents={backToContents}
        shouldFocus={shouldFocus}
        examZone={examZone}
      />
    )
  }

  return (
    <div className="learn-page">
      <LearnHeader trail={trail} progress={workspace.progress} onOpenContents={narrow ? () => setDrawerOpen(true) : undefined} />
      <div className="learn-body">
        {narrow ? null : (
          <aside className="learn-sidebar" ref={sidebarRef} tabIndex={-1}>
            <CurriculumNav workspace={workspace} currentItemId={itemId} toggles={toggles} headingId={SIDEBAR_HEADING} />
          </aside>
        )}
        <main className="learn-main" id="learn-main">
          <div className="learn-main__inner">
            {shownNotice ? <Alert type="info" showIcon closable onClose={() => setNotice(null)} title={t(`learn.notices.${shownNotice}`)} /> : null}
            {main}
          </div>
        </main>
      </div>
      {narrow ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement={language === 'ar' ? 'right' : 'left'}
          size="min(360px, 92vw)"
          title={t('learn.sidebar.title')}
        >
          <CurriculumNav
            workspace={workspace}
            currentItemId={itemId}
            toggles={toggles}
            headingId={DRAWER_HEADING}
            headingHidden
            onPick={() => setDrawerOpen(false)}
          />
        </Drawer>
      ) : null}
      <CourseDoneModal open={courseDone} onClose={() => setCourseDone(false)} />
    </div>
  )
}
