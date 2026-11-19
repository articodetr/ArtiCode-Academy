// One lesson in the course player (MOD-20): its heading (level, kind, length,
// «اختياري»), its content by kind, how it completes, what it carries beside
// (description, resources, assignments, exams), and the way on — «السابق» /
// «التالي» in learning order across the levels (API-231 `neighbors`), and
// back to the curriculum. Mounted once per lesson (keyed by its id), so a
// player, a form or a failure of one lesson never leaks into the next; the
// heading takes the focus when the learner moved here from another lesson.
import { ArrowLeftOutlined, ArrowRightOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Button, Tag } from 'antd'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearningItem, PlaybackResult } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { CompletionPanel } from './CompletionPanel'
import { itemDurationLabel, levelName } from './learn.format'
import { KindIcon } from './LearnIcons'
import { LessonContent } from './LessonContent'
import { LessonSections } from './LessonSections'

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
}

export function LessonView({ item, onComplete, onPlayback, onNavigate, onBackToContents, shouldFocus, examZone }: LessonViewProps) {
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
        </p>
      </header>

      <section className="learn-card learn-lesson__content">
        <LessonContent item={item} onPlayback={(result) => onPlayback(item.id, result)} />
      </section>

      <CompletionPanel item={item} onComplete={onComplete} />

      <LessonSections item={item} examZone={examZone} />

      <nav className="learn-nav" aria-label={t('learn.nav.label')}>
        <Button
          className="learn-nav__step"
          icon={rtl ? <ArrowRightOutlined aria-hidden /> : <ArrowLeftOutlined aria-hidden />}
          disabled={previous === null}
          onClick={() => previous && onNavigate(previous.id)}
        >
          <span className="learn-nav__label">
            <span>{t('learn.nav.previous')}</span>
            {previous ? <span className="learn-nav__title">{localizedLabel(previous.title, language)}</span> : null}
          </span>
        </Button>
        <Button className="learn-nav__contents" type="text" icon={<UnorderedListOutlined aria-hidden />} onClick={onBackToContents}>
          {t('learn.nav.backToContents')}
        </Button>
        <Button
          className="learn-nav__step learn-nav__step--next"
          type={next ? 'primary' : 'default'}
          icon={rtl ? <ArrowLeftOutlined aria-hidden /> : <ArrowRightOutlined aria-hidden />}
          iconPlacement="end"
          disabled={next === null}
          onClick={() => next && onNavigate(next.id)}
        >
          <span className="learn-nav__label">
            <span>{t('learn.nav.next')}</span>
            {next ? <span className="learn-nav__title">{localizedLabel(next.title, language)}</span> : null}
          </span>
        </Button>
      </nav>
    </article>
  )
}
