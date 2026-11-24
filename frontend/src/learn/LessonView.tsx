// One lesson in the course player (MOD-20): its heading (level, kind, length,
// «اختياري»), its content by kind, where the learner stands in it (completed or
// the watched share — no button and no side sections since AHMED-TT-1: the
// description, resources, assignments and exams stay on their own pages), and the way on — «السابق» /
// «التالي» in learning order across the levels (API-231 `neighbors` — none
// skipped; a step toward a lesson of a level not open yet is disabled,
// D-R145), and back to the curriculum. The author's preview renders it with
// `preview`: nothing is tracked or completed, the draft lesson tagged. Mounted once per lesson (keyed by its id), so a
// player, a form or a failure of one lesson never leaks into the next; the
// heading takes the focus when the learner moved here from another lesson.
import { ArrowLeftOutlined, ArrowRightOutlined, LockOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Button, Tag } from 'antd'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem, LearningNeighbor, PlaybackResult } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { CompletionPanel } from './CompletionPanel'
import { itemDurationLabel, levelName } from './learn.format'
import { KindIcon } from './LearnIcons'
import { LessonContent } from './LessonContent'

export interface LessonViewProps {
  item: LearningItem
  onComplete: (itemId: string) => Promise<void>
  onPlayback: (itemId: string, result: PlaybackResult) => void
  onNavigate: (itemId: string) => void
  onBackToContents: () => void
  /** Asked on mount: true when the heading should take the focus (the learner came here from another lesson). */
  shouldFocus: (itemId: string) => boolean
  /** The academy's zone for exam times (API-231 exams carry none). */
  examZone: string | undefined
  /** The author's preview: no playback is saved, the completion button is disabled (D-R144). */
  preview?: boolean
  /** The lesson is not published (preview only): tagged «مسودّة». */
  draft?: boolean
}

/** A step of «السابق» / «التالي» is possible toward a lesson that can be opened (D-R145 — a body without the field reads as open). */
function reachable(neighbor: LearningNeighbor | null): neighbor is LearningNeighbor {
  return neighbor !== null && neighbor.available !== false
}

export function LessonView({ item, onComplete, onPlayback, onNavigate, onBackToContents, shouldFocus, preview = false, draft = false }: LessonViewProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shouldFocusRef = useRef(shouldFocus)
  const itemId = item.id

  useEffect(() => {
    if (shouldFocusRef.current(itemId)) headingRef.current?.focus()
  }, [itemId])

  const duration = itemDurationLabel(item, t)
  const { previous, next } = item.neighbors
  const rtl = language === 'ar'

  return (
    <article className="learn-lesson">
      <header className="learn-card learn-lesson__header">
        <p className="learn-lesson__eyebrow">{levelName(item.section, t, language)}</p>
        <h1 className="learn-lesson__title" ref={headingRef} tabIndex={-1}>
          {localizedLabel(item.title, language)}
        </h1>
        <p className="learn-lesson__meta">
          <span className="learn-lesson__kind">
            <KindIcon kind={item.kind} />
            {t(`learn.kinds.${item.kind}`)}
          </span>
          {duration ? <span>{duration.clock ? <bdi dir="ltr">{duration.text}</bdi> : duration.text}</span> : null}
          {item.isRequired ? null : <Tag bordered={false}>{t('learn.lesson.optional')}</Tag>}
          {draft ? (
            <Tag color="gold" bordered={false}>
              {t('learn.preview.draft')}
            </Tag>
          ) : null}
        </p>
      </header>

      <section className="learn-card learn-lesson__content">
        <LessonContent item={item} onPlayback={(result) => onPlayback(item.id, result)} trackPlayback={!preview} onComplete={preview ? undefined : onComplete} />
      </section>

      <CompletionPanel item={item} />

      <nav className="learn-nav" aria-label={t('learn.nav.label')}>
        <Button
          className="learn-nav__step"
          icon={rtl ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}
          disabled={!reachable(previous)}
          onClick={() => reachable(previous) && onNavigate(previous.id)}
        >
          <span className="learn-nav__label">
            <span>{t('learn.nav.previous')}</span>
            {previous ? <NeighborTitle neighbor={previous} /> : null}
          </span>
        </Button>
        <Button className="learn-nav__contents" type="text" icon={<UnorderedListOutlined aria-hidden />} onClick={onBackToContents}>
          {t('learn.nav.backToContents')}
        </Button>
        <Button
          className="learn-nav__step learn-nav__step--next"
          type={reachable(next) ? 'primary' : 'default'}
          icon={rtl ? <ArrowLeftOutlined aria-hidden /> : <ArrowRightOutlined aria-hidden />}
          iconPlacement="end"
          disabled={!reachable(next)}
          onClick={() => reachable(next) && onNavigate(next.id)}
        >
          <span className="learn-nav__label">
            <span>{t('learn.nav.next')}</span>
            {next ? <NeighborTitle neighbor={next} /> : null}
          </span>
        </Button>
      </nav>
    </article>
  )
}

/** The neighbour's title; one whose level is not open yet carries a lock and says so (D-R145). */
function NeighborTitle({ neighbor }: { neighbor: LearningNeighbor }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const locked = neighbor.available === false
  return (
    <span className="learn-nav__title">
      {locked ? <LockOutlined aria-hidden /> : null} {localizedLabel(neighbor.title, language)}
      {locked ? <span className="learn-sr-only"> {t('learn.nav.locked')}</span> : null}
    </span>
  )
}
