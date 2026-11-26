// The opened lesson of a lessons panel (J-F64; shared since J-F67 by a course's panel in «دوراتي» and by the list of
// every course's lessons in «دروسي»). Since J-F67 (Jallal's request) it plays in a popup above the list — closing it
// (its button, Escape or the mask) closes the lesson and keeps the list where it was. Since J-F69 (Jallal's reference
// of the popup) the popup's head is the lesson's title with «×», its body is HubLessonBody (a card of the course, the
// level, the teacher, the kind and the session, then the content), and the previous and the next lesson are two round
// arrows on the popup's right and left (on a phone, at the bottom corners) — a step keeps the popup open and the arrow
// focused while the next lesson loads. Everything about the lesson is the course player's own: its content,
// completion, resources and neighbours, API-231..234; every answer is carried into the course's workspace at once
// (`updateWorkspace`), and a completion reads it again in the background.
import { CloseOutlined, LeftOutlined, LockOutlined, RightOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Skeleton, Tag } from 'antd'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../../academy/useAcademy'
import { completeLearningItem } from '../../api/learning'
import type { ItemProgress, LearningCertificate, LearningNeighbor, LearningWorkspace, MyLearningCourse, PlaybackResult } from '../../api/learning'
import { academyTimeZoneOf } from '../../common/timeZone'
import { directionOf } from '../../i18n/language'
import { useLocalized } from '../../i18n/useLocalized'
import { formatDay, localizedLabel } from '../../users/users.format'
import { CourseDoneModal } from '../CourseDoneModal'
import { completesCourse, withItemProgress } from '../learn.state'
import type { CountsUpdate } from '../learn.state'
import { useLearningItem } from '../useLearningItem'
import { HubLessonBody } from './HubLessonBody'
import { isReachable, workspaceItemOf } from './hubLesson.view'

interface HubPlayerProps {
  /** The lesson's course as «دوراتي» lists it (API-229): named in the lesson's card with its lead teacher. */
  course: MyLearningCourse
  lessonId: string
  workspace: LearningWorkspace | null
  updateWorkspace: (change: (workspace: LearningWorkspace) => LearningWorkspace) => void
  reloadWorkspace: () => void
  /** Opens another lesson of the same course (its neighbours). */
  onOpen: (id: string) => void
  /** Closes the lesson (`replace` when the lesson went away under it). */
  onClose: (replace?: boolean) => void
  /** Why the lesson was closed for the learner (gone, or its level not open). */
  onNotice: (message: string) => void
  /** An exam popup of the lesson closed: the course (and the page's certificates) may have changed. */
  onExamClosed?: () => void
}

export function HubPlayer({ course, lessonId, workspace, updateWorkspace, reloadWorkspace, onOpen, onClose, onNotice, onExamClosed }: HubPlayerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { academy } = useAcademy()
  const [courseDone, setCourseDone] = useState(false)
  // CH-0363 + J-F67: the certificate the completion issued (the full-page player shows it too); null = none yet.
  const [certificate, setCertificate] = useState<LearningCertificate | null>(null)

  const itemReading = useLearningItem(lessonId, {
    onVisited: (id, progress) => updateWorkspace((current) => withItemProgress(current, id, progress)),
    onGone: () => {
      onNotice(t('learn.notices.lessonUnavailable'))
      reloadWorkspace()
      onClose(true)
    },
    onLocked: (_id, opensOn) => {
      onNotice(opensOn ? t('learn.notices.levelNotOpen', { date: formatDay(opensOn, language) }) : t('learn.notices.levelNotOpenNoDate'))
      reloadWorkspace()
      onClose(true)
    },
  })
  const { setProgress } = itemReading
  const item = itemReading.item

  // The arrows keep the last lesson's neighbours while the next one loads: they stay where they are (and focused).
  const [neighbors, setNeighbors] = useState(item?.neighbors ?? null)
  if (item && item.neighbors !== neighbors) setNeighbors(item.neighbors)

  const workspaceRef = useRef<LearningWorkspace | null>(workspace)
  useLayoutEffect(() => {
    workspaceRef.current = workspace
  })

  const applyAnswer = useCallback(
    (id: string, progress: ItemProgress, counts: CountsUpdate, completedNow: boolean, issued: LearningCertificate | null) => {
      const before = workspaceRef.current?.progress
      setProgress(id, progress)
      updateWorkspace((current) => withItemProgress(current, id, progress, counts))
      if (before && completesCourse(before, counts.course, completedNow)) {
        setCertificate(issued)
        setCourseDone(true)
      }
      if (completedNow) reloadWorkspace()
    },
    [setProgress, updateWorkspace, reloadWorkspace],
  )
  const completeItem = useCallback(
    async (id: string) => {
      const result = await completeLearningItem(id)
      applyAnswer(id, result.progress, { section: result.section, course: result.course }, result.completedNow, result.certificate ?? null)
    },
    [applyAnswer],
  )
  const playbackSaved = useCallback(
    (id: string, result: PlaybackResult) => applyAnswer(id, result.progress, { course: result.course }, result.completedNow, result.certificate ?? null),
    [applyAnswer],
  )
  const examClosed = useCallback(() => {
    reloadWorkspace()
    onExamClosed?.()
  }, [reloadWorkspace, onExamClosed])

  const title = item ? localizedLabel(item.title, language) : localizedLabel(course.course.name, language)
  const exams = workspaceItemOf(workspace, lessonId)?.exams ?? []

  return (
    <>
      <Modal
        open
        footer={null}
        closable={false}
        width={{ xs: 'calc(100vw - 16px)', md: 'min(920px, calc(100vw - 160px))' }}
        centered
        destroyOnHidden
        onCancel={() => onClose()}
        rootClassName="hub-sessions hub-player-modal"
      >
        <section className="hub-player" aria-label={t('myLessons.hub.player.label')}>
          <header className="hub-player__head">
            <h2 className="hub-player__title">
              <bdi>{title}</bdi>
              {item && !item.isRequired ? (
                <Tag bordered={false} className="hub-player__tag">
                  {t('learn.lesson.optional')}
                </Tag>
              ) : null}
            </h2>
            <Button
              type="text"
              shape="circle"
              className="hub-player__close"
              icon={<CloseOutlined aria-hidden />}
              aria-label={t('myLessons.hub.player.close')}
              title={t('myLessons.hub.player.close')}
              onClick={() => onClose()}
            />
          </header>
          {neighbors ? (
            <nav className="hub-player__steps" aria-label={t('learn.nav.label')}>
              <StepButton side="previous" neighbor={neighbors.previous} busy={itemReading.loading} onOpen={onOpen} />
              <StepButton side="next" neighbor={neighbors.next} busy={itemReading.loading} onOpen={onOpen} />
            </nav>
          ) : null}
          {itemReading.loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : item ? (
            <HubLessonBody
              key={item.id}
              item={item}
              course={course}
              exams={exams}
              classId={workspace?.enrollment.class.id ?? null}
              onComplete={completeItem}
              onPlayback={playbackSaved}
              examZone={academyTimeZoneOf(academy) ?? undefined}
              onExamClosed={examClosed}
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
      </Modal>
      <CourseDoneModal open={courseDone} certificate={certificate} onClose={() => setCourseDone(false)} />
    </>
  )
}

/**
 * One side arrow: «السابق» on the start side (the right in Arabic), «التالي» on the end side, naming the lesson it opens.
 * None where there is no lesson; disabled toward a lesson whose level is not open yet (D-R145); inert while a lesson loads.
 */
function StepButton({ side, neighbor, busy, onOpen }: { side: 'previous' | 'next'; neighbor: LearningNeighbor | null; busy: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (!neighbor) return null
  const reachable = isReachable(neighbor)
  const name = localizedLabel(neighbor.title, language)
  const label = t(`myLessons.hub.player.${side}`, { title: name })
  const locked = !reachable
  // The arrow points the way the step goes: «السابق» toward the start side, «التالي» toward the end side.
  const towardStart = side === 'previous'
  const pointsRight = directionOf(language) === 'rtl' ? towardStart : !towardStart
  return (
    <button
      type="button"
      className={`hub-player__step hub-player__step--${side}`}
      aria-label={locked ? `${label} — ${t('learn.nav.locked')}` : label}
      title={locked ? `${name} — ${t('learn.nav.locked')}` : name}
      disabled={locked}
      // While a lesson loads the arrow stays enabled (a disabled button would drop the keyboard focus): it does nothing.
      aria-disabled={busy || undefined}
      onClick={() => {
        if (reachable && !busy) onOpen(neighbor.id)
      }}
    >
      {locked ? <LockOutlined aria-hidden className="hub-player__step-lock" /> : null}
      {pointsRight ? <RightOutlined aria-hidden /> : <LeftOutlined aria-hidden />}
    </button>
  )
}
