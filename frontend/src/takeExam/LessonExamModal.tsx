// The exam of a lesson in a popup (J-F67 — Jallal's request: «عند الضغط على الاختبار ان تكون فيه قائمة منبثقة تظهر فيه
// هذه الصفحة من اجل الاختبار»), opened by «الاختبار» of a lesson row in «دروسي» and «دوراتي». It reads the learner's
// own row of the exam in «my exams» (API-121 — the same rules as /my-exams), then:
// - an attempt in progress → the exam screen at once, in the popup (TakeExamScreen, embedded);
// - a new attempt can start → the very confirmation of «my exams» (StartAttemptModal: the rules, «ابدأ الآن» with the
//   attempt number the row showed), then the exam screen in the popup;
// - anything else (a manual exam, a closed window, no attempt left, not found) → a short note and «اختباراتي».
// Closing the popup while an answer has not reached the server asks first; leaving never submits — the screen sends
// what is unsaved once more as it goes, and the server's clock keeps running (the screen says so).
import { Alert, Button, Modal, Skeleton } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { listMyExams } from '../api/myExams'
import type { MyExamItem } from '../api/myExams'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { isOnlineItem, takeStateOf } from '../exams/myExams.view'
import type { OnlineMyExamItem } from '../exams/myExams.view'
import { StartAttemptModal } from './StartAttemptModal'
import { TakeExamScreen } from './TakeExamScreen'
import { MY_EXAMS_ROUTE } from './takeExam.format'
import './takeExam.css'

/** Pages of «my exams» read at most while looking for the exam (100 each). */
const MAX_PAGES = 5

/** The learner's own row of the exam in «my exams», or null when it is not there. */
async function findMyExam(examId: string, signal: AbortSignal): Promise<MyExamItem | null> {
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const list = await listMyExams({ limit: 100, cursor }, signal)
    const found = list.items.find((item) => item.id === examId && item.relation === 'self')
    if (found) return found
    if (!list.nextCursor) return null
    cursor = list.nextCursor
  }
  return null
}

type Reading = { kind: 'loading' } | { kind: 'failed' } | { kind: 'found'; item: MyExamItem | null }

interface LessonExamModalProps {
  examId: string
  /** The exam's title, while its row is read. */
  title: string
  onClose: () => void
}

export function LessonExamModal({ examId, title, onClose }: LessonExamModalProps) {
  const { t } = useTranslation()
  const [reading, setReading] = useState<Reading>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  // The attempt on screen, once started or found in progress.
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)
  const { requestClose } = useUnsavedChangesGuard(unsaved, onClose, 'takeExam.leave.unsaved')

  useEffect(() => {
    const controller = new AbortController()
    findMyExam(examId, controller.signal).then(
      (item) => {
        if (controller.signal.aborted) return
        setReading({ kind: 'found', item })
        // An attempt in progress opens straight away, as «متابعة الاختبار» of «my exams».
        if (item && isOnlineItem(item) && item.online.inProgress) setAttemptId(item.online.inProgress.id)
      },
      () => {
        if (!controller.signal.aborted) setReading({ kind: 'failed' })
      },
    )
    return () => controller.abort()
  }, [examId, tick])

  const reload = useCallback(() => {
    setReading({ kind: 'loading' })
    setTick((value) => value + 1)
  }, [])

  // The exam itself, in a wide popup.
  if (attemptId) {
    return (
      <Modal
        open
        footer={null}
        width="min(1240px, 98vw)"
        centered
        destroyOnHidden
        onCancel={requestClose}
        rootClassName="take-exam-modal"
        title={title}
      >
        <TakeExamScreen key={attemptId} attemptId={attemptId} embedded onUnsavedChange={setUnsaved} />
      </Modal>
    )
  }

  const item = reading.kind === 'found' ? reading.item : null
  const online = item && isOnlineItem(item) ? item : null
  const state = online ? takeStateOf(online.online) : null

  // A new attempt can start: the confirmation of «my exams», which hands the attempt back here.
  if (online && state?.kind === 'start') {
    return <StartAttemptModal item={online} onClose={onClose} onRefused={reload} onStarted={setAttemptId} />
  }

  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Link key="exams" to={MY_EXAMS_ROUTE} className="ant-btn ant-btn-default" onClick={onClose}>
          {t('myLessons.hub.examPopup.toMyExams')}
        </Link>,
        <Button key="close" type="primary" onClick={onClose}>
          {t('takeExam.start.close')}
        </Button>,
      ]}
    >
      {reading.kind === 'loading' ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : reading.kind === 'failed' ? (
        <Alert
          type="error"
          showIcon
          title={t('myLessons.hub.examPopup.loadFailed')}
          action={
            <Button size="small" onClick={reload}>
              {t('learn.load.retry')}
            </Button>
          }
        />
      ) : item === null ? (
        <Alert type="info" showIcon title={t('myLessons.hub.examPopup.notFound')} />
      ) : online === null ? (
        <Alert type="info" showIcon title={t('myLessons.hub.examPopup.manual')} />
      ) : (
        <Alert type="warning" showIcon title={blockedText(t, online)} />
      )}
    </Modal>
  )
}

/** Why the exam cannot be taken now, in the words of «my exams». */
function blockedText(t: ReturnType<typeof useTranslation>['t'], item: OnlineMyExamItem): string {
  const { online } = item
  switch (online.blocker) {
    case 'attempts_exhausted':
      return t('takeExam.list.blocked.attempts_exhausted', { used: online.attemptsUsed, allowed: online.attemptsAllowed })
    case null:
      return t('takeExam.list.unavailable')
    default:
      return t(`takeExam.list.blocked.${online.blocker}`)
  }
}
