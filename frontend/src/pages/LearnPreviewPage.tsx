// «معاينة كطالب» (MOD-20 — D-R144): /learn/:courseId/preview and
// /learn/:courseId/preview/:itemId show a course the way a learner sees it in
// the course player — the same header, curriculum and lesson view — from the
// curriculum its author reads (API-226: `courses.manage`, or a teacher of the
// course; anyone else gets 404, worded here). A fixed banner says it is a
// preview; nothing is recorded: no visit, no playback save, no completion
// (API-229..234 are never called — the completion button shows disabled).
// Published lessons only, or the drafts too with «إظهار المسودّات» (kept in
// the address as `?drafts=1`, tagged «مسودّة»); every level is open, its
// `releaseAfterDays` stated (D-R145). Outside the app layout, as the player.
import { EyeOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Result, Skeleton, Switch } from 'antd'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAcademy } from '../academy/useAcademy'
import { DEFAULT_VIDEO_COMPLETION_PERCENT, videoCompletionPercentOf } from '../academy/academy.settings'
import { ApiError } from '../api/client'
import { useLocalized } from '../i18n/useLocalized'
import { CurriculumNav } from '../learn/CurriculumNav'
import { levelName } from '../learn/learn.format'
import { previewItemOf, previewModelOf } from '../learn/learn.preview'
import { placeOf, sectionKeyOf } from '../learn/learn.state'
import { LearnHeader } from '../learn/LearnHeader'
import type { LearnHome } from '../learn/LearnHeader'
import { LessonView } from '../learn/LessonView'
import { useCurriculumPreview } from '../learn/useCurriculumPreview'
import { useLevelToggles } from '../learn/useLevelToggles'
import { useNarrowScreen } from '../learn/useNarrowScreen'
import { localizedLabel } from '../users/users.format'
import '../learn/learn.css'

const DRAFTS_PARAM = 'drafts'
const SIDEBAR_HEADING = 'learn-preview-curriculum-heading'
const DRAWER_HEADING = 'learn-preview-curriculum-drawer-heading'
const COURSES_PATH = '/courses'

function previewPath(courseId: string, itemId?: string): string {
  const base = `/learn/${encodeURIComponent(courseId)}/preview`
  return itemId ? `${base}/${encodeURIComponent(itemId)}` : base
}

const noop = () => undefined
const resolved = () => Promise.resolve()

export function LearnPreviewPage() {
  const { courseId = '', itemId } = useParams<{ courseId: string; itemId?: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { language } = useLocalized()
  const narrow = useNarrowScreen()
  const { academy } = useAcademy()
  const switchLabelId = useId()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const showDrafts = params.get(DRAFTS_PARAM) === '1'
  const search = showDrafts ? `?${DRAFTS_PARAM}=1` : ''
  const reading = useCurriculumPreview(courseId)
  const curriculum = reading.curriculum
  const model = useMemo(() => (curriculum ? previewModelOf(curriculum, { showDrafts }) : null), [curriculum, showDrafts])
  const completionPercent = videoCompletionPercentOf(academy?.settings) ?? DEFAULT_VIDEO_COMPLETION_PERCENT

  const place = placeOf(model?.workspace ?? null, itemId)
  const toggles = useLevelToggles(`preview.${courseId}`, place ? sectionKeyOf(place.section) : null)
  const sidebarRef = useRef<HTMLElement>(null)

  // The heading of a lesson takes the focus when the author came from another lesson (not on arrival).
  const shownLessonRef = useRef<string | null>(null)
  const shouldFocus = useCallback((id: string) => {
    const previous = shownLessonRef.current
    shownLessonRef.current = id
    return previous !== null && previous !== id
  }, [])

  const itemPath = useCallback((id: string) => `${previewPath(courseId, id)}${search}`, [courseId, search])

  const home: LearnHome = { to: COURSES_PATH, crumb: t('learn.preview.courses'), back: t('learn.preview.backToCourses') }

  const banner = (
    <div className="learn-preview-banner" data-testid="learn-preview-banner">
      <span className="learn-preview-banner__text">
        <EyeOutlined aria-hidden />
        <strong>{t('learn.preview.banner')}</strong>
      </span>
      <span className="learn-preview-banner__drafts">
        <Switch
          size="small"
          checked={showDrafts}
          aria-labelledby={switchLabelId}
          onChange={(checked) => setParams(checked ? { [DRAFTS_PARAM]: '1' } : {}, { replace: true })}
        />
        <span id={switchLabelId}>{t('learn.preview.showDrafts')}</span>
      </span>
    </div>
  )

  const shell = (content: ReactNode, options: { trail?: string[]; sidebar?: boolean } = {}) => (
    <div className="learn-page learn-page--preview">
      {banner}
      <LearnHeader home={home} trail={options.trail} onOpenContents={options.sidebar && narrow ? () => setDrawerOpen(true) : undefined} />
      {content}
    </div>
  )

  // --- The curriculum cannot be read --------------------------------------------
  if (reading.error) {
    if (reading.error instanceof ApiError && reading.error.status === 404) {
      return shell(
        <main className="learn-main">
          <div className="learn-main__inner">
            <Result
              className="learn-card learn-access"
              status="warning"
              title={<h1 className="learn-access__title">{t('learn.preview.notAllowedTitle')}</h1>}
              subTitle={t('learn.preview.notAllowedText')}
              extra={
                <Button type="primary" onClick={() => navigate(COURSES_PATH)}>
                  {t('learn.preview.backToCourses')}
                </Button>
              }
            />
          </div>
        </main>,
      )
    }
    return shell(
      <main className="learn-main">
        <div className="learn-main__inner">
          <Alert
            type="error"
            showIcon
            title={t('learn.preview.loadError')}
            action={
              <Button size="small" onClick={reading.reload}>
                {t('learn.load.retry')}
              </Button>
            }
          />
        </div>
      </main>,
    )
  }

  if (!model) {
    return shell(
      <main className="learn-main">
        <div className="learn-main__inner">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      </main>,
    )
  }

  // --- /learn/:courseId/preview — the first shown lesson; a lesson the switch hides goes back there ---
  const first = model.order[0]
  if (!itemId && first) return <Navigate to={`${previewPath(courseId, first)}${search}`} replace />
  if (itemId && !model.places.has(itemId)) return <Navigate to={`${previewPath(courseId)}${search}`} replace />

  const item = itemId ? previewItemOf(model, itemId, completionPercent) : null
  const courseName = localizedLabel(model.workspace.course.name, language)
  const trail = [courseName, ...(item ? [levelName(item.section, t, language), localizedLabel(item.title, language)] : [])]

  const backToContents = () => {
    if (narrow) {
      setDrawerOpen(true)
      return
    }
    const sidebar = sidebarRef.current
    const current = sidebar?.querySelector<HTMLElement>('[aria-current="page"]')
    ;(current ?? sidebar)?.focus()
  }

  const annotations = { drafts: model.drafts, releaseAfterDays: model.releaseAfterDays }
  const main = item ? (
    <LessonView
      key={item.id}
      item={item}
      onComplete={resolved}
      onPlayback={noop}
      onNavigate={(id) => navigate(itemPath(id))}
      onBackToContents={backToContents}
      shouldFocus={shouldFocus}
      examZone={undefined}
      preview
      draft={model.drafts.has(item.id)}
    />
  ) : (
    <Alert type="info" showIcon title={t(model.hiddenDrafts > 0 ? 'learn.preview.noPublished' : 'learn.preview.noLessons')} />
  )

  return shell(
    <>
      <div className="learn-body">
        {narrow ? null : (
          <aside className="learn-sidebar" ref={sidebarRef} tabIndex={-1}>
            <CurriculumNav
              workspace={model.workspace}
              currentItemId={itemId}
              toggles={toggles}
              headingId={SIDEBAR_HEADING}
              itemPath={itemPath}
              annotations={annotations}
            />
          </aside>
        )}
        <main className="learn-main" id="learn-main">
          <div className="learn-main__inner">{main}</div>
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
            workspace={model.workspace}
            currentItemId={itemId}
            toggles={toggles}
            headingId={DRAWER_HEADING}
            headingHidden
            itemPath={itemPath}
            annotations={annotations}
            onPick={() => setDrawerOpen(false)}
          />
        </Drawer>
      ) : null}
    </>,
    { trail, sidebar: true },
  )
}
