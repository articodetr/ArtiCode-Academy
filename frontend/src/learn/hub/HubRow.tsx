// One lesson row of a lessons panel (J-F64; shared since J-F67 by a course's panel in «دوراتي» and by the list of every
// course's lessons in «دروسي», which names the lesson's course and level above its title). The badges, the watched
// share and the main button are the course player's: a medium plays, a live lesson shows its sessions, anything else
// opens; a lesson of a level not open yet shows the day it opens instead (D-R145). Beside the main button (J-F67,
// Jallal's request) the lesson's exam — «الاختبار», which opens the exam in a popup (LessonExamModal) — and its attachments — «المرفق»,
// each opened in a new tab — as API-230 lists them; more than one of either is a small menu.
import { BookOutlined, CheckCircleFilled, LockOutlined, PaperClipOutlined, PlayCircleFilled, VideoCameraOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { WorkspaceItem } from '../../api/learning'
import { useAuth } from '../../auth/auth-context'
import { useLocalized } from '../../i18n/useLocalized'
import { formatDay, localizedLabel } from '../../users/users.format'
import { itemDurationLabel } from '../learn.format'
import { isItemAvailable } from '../learn.state'
import { useWatchedPercent } from '../watched.store'
import { rowActionOf } from './hub.view'
import { LessonExams } from './LessonExams'
import { ResourcesButton } from './ResourcesButton'

interface HubRowProps {
  item: WorkspaceItem
  number: number
  current: boolean
  opensOn: string | null
  onOpen: (id: string) => void
  /** «دروسي»: the lesson's course (and level), above its title — a course's own panel names the course in its head. */
  origin?: string
  /** The exam popup closed: the panel reads the course again, so «تم الاختبار» shows at once. */
  onExamClosed?: () => void
}

export function HubRow({ item, number, current, opensOn, onOpen, origin, onExamClosed }: HubRowProps) {
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
  const title = localizedLabel(item.title, language)
  // The one kind badge a row keeps: «درس مباشر», or the kind of a lesson that is not a video.
  const badgeKind = live ? 'live' : item.kind === 'video' ? null : 'kind'
  const inProgress = !completed && item.state === 'in_progress'

  return (
    <li className={`hub-row${current ? ' is-current' : ''}${available ? '' : ' is-locked'}`} aria-current={current ? 'true' : undefined}>
      <span className="hub-row__number" aria-hidden>
        {completed ? <CheckCircleFilled /> : number}
      </span>
      <div className="hub-row__main">
        {origin ? (
          <p className="hub-row__origin">
            <BookOutlined aria-hidden /> {origin}
          </p>
        ) : null}
        {/* Fewer words on screen (Jallal's request, J-F67): a recorded lesson says so by its «تشغيل الدرس» and a
            completed one by the tick beside it — neither has a badge any more; a live lesson, another kind, a lesson
            in progress and an optional one still do. */}
        {badgeKind || inProgress || !item.isRequired ? (
          <div className="hub-row__badges">
            {badgeKind === 'live' ? (
              <span className="hub-badge hub-badge--live">
                <VideoCameraOutlined aria-hidden /> {t('myLessons.hub.row.live')}
              </span>
            ) : badgeKind === 'kind' ? (
              <span className="hub-badge hub-badge--kind">{t(`learn.kinds.${item.kind}`)}</span>
            ) : null}
            {inProgress ? <span className="hub-badge hub-badge--progress">{t('myLessons.hub.row.inProgress')}</span> : null}
            {item.isRequired ? null : <span className="hub-badge hub-badge--kind">{t('learn.lesson.optional')}</span>}
          </div>
        ) : null}
        <h4 className="hub-row__title">
          <span className="learn-sr-only">{number}. </span>
          {title}
          {/* The tick is an icon: a screen reader hears the state here. */}
          {completed ? (
            <>
              {' '}
              <span className="learn-sr-only">{t('myLessons.hub.row.completed')}</span>
            </>
          ) : null}
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
        ) : (
          <>
            {current ? (
              <span className="hub-playing">{t('myLessons.hub.row.playing')}</span>
            ) : (
              <button
                type="button"
                className={`hub-btn ${action === 'play' ? (live ? 'hub-btn--live' : 'hub-btn--play') : 'hub-btn--open'}`}
                onClick={() => onOpen(item.id)}
              >
                {action === 'play' ? (live ? <VideoCameraOutlined aria-hidden /> : <PlayCircleFilled aria-hidden />) : null}{' '}
                {t(`myLessons.hub.row.${action}`)}
                <span className="learn-sr-only">: {title}</span>
              </button>
            )}
            <LessonExams exams={item.exams ?? []} lessonTitle={title} onClosed={onExamClosed} />
            <ResourcesButton
              resources={item.resources ?? []}
              label={t('myLessons.hub.row.file')}
              labelMany={t('myLessons.hub.row.files', { n: item.resources?.length ?? 0 })}
              context={title}
              className="hub-btn--open"
            />
          </>
        )}
      </div>
    </li>
  )
}
