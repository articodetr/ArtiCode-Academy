// The opened lesson of a lessons panel (J-F64; shared since J-F67 by a course's panel in «دوراتي» and by the list of
// every course's lessons in «دروسي»). Since J-F67 (Jallal's request) it plays in a popup above the list — closing it
// (its button, Escape or the mask) closes the lesson and keeps the list where it was. Everything about the lesson is the course player's
// own: its content, completion, resources and neighbours (LessonView), API-231..234; every answer is carried into the
// course's workspace at once (`updateWorkspace`), and a completion reads it again in the background.
import { CloseOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Skeleton } from 'antd'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAcademy } from '../../academy/useAcademy'
import { completeLearningItem } from '../../api/learning'
import type { ItemProgress, LearningCertificate, LearningWorkspace, PlaybackResult } from '../../api/learning'
import { academyTimeZoneOf } from '../../common/timeZone'
import { useLocalized } from '../../i18n/useLocalized'
import { formatDay } from '../../users/users.format'
import { CourseDoneModal } from '../CourseDoneModal'
import { completesCourse, withItemProgress } from '../learn.state'
import type { CountsUpdate } from '../learn.state'
import { LessonView } from '../LessonView'
import { useLearningItem } from '../useLearningItem'

interface HubPlayerProps {
  /** The lesson's course, named in the player's head. */
  courseName: string
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
  /** «العودة إلى المحتويات»: back to the list. */
  onBackToContents: () => void
}

export function HubPlayer({ courseName, lessonId, workspace, updateWorkspace, reloadWorkspace, onOpen, onClose, onNotice, onBackToContents }: HubPlayerProps) {
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

  const shownLessonRef = useRef<string | null>(null)
  const shouldFocus = useCallback((id: string) => {
    const previous = shownLessonRef.current
    shownLessonRef.current = id
    return previous !== null && previous !== id
  }, [])

  return (
    <>
      <Modal
        open
        footer={null}
        closable={false}
        width="min(1080px, 96vw)"
        centered
        destroyOnHidden
        onCancel={() => onClose()}
        rootClassName="hub-sessions hub-player-modal"
      >
        <section className="hub-player" aria-label={t('myLessons.hub.player.label')}>
          <div className="hub-player__head">
            <span className="hub-gold">{courseName}</span>
            <Button icon={<CloseOutlined aria-hidden />} onClick={() => onClose()}>
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
              onNavigate={onOpen}
              onBackToContents={onBackToContents}
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
      </Modal>
      <CourseDoneModal open={courseDone} certificate={certificate} onClose={() => setCourseDone(false)} />
    </>
  )
}
