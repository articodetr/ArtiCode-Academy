// The curriculum of the course player (MOD-20 — D-R130, D-R132): the levels
// of API-230 in the server's order, each a real button that expands or
// collapses its lessons (`aria-expanded`), with its own «n/m» and completion
// mark; every lesson is a link (no lock between levels — D-R132), the current
// one marked `aria-current="page"`. Shown at the start side of the page, or
// inside the drawer on a narrow screen. Every state shown is the server's.
import { DownOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { LearningWorkspace, WorkspaceItem, WorkspaceSection } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { itemDurationLabel, levelName } from './learn.format'
import { sectionKeyOf } from './learn.state'
import { KindIcon, StateIcon } from './LearnIcons'
import type { LevelToggles } from './useLevelToggles'

export interface CurriculumNavProps {
  workspace: LearningWorkspace
  currentItemId: string | undefined
  toggles: LevelToggles
  /** A lesson was picked (the drawer closes). */
  onPick?: () => void
  /** The heading's id, for the landmark that names the sidebar. */
  headingId: string
  /** Inside the drawer, whose own title says the same, the heading is for screen readers only. */
  headingHidden?: boolean
}

export function CurriculumNav({ workspace, currentItemId, toggles, onPick, headingId, headingHidden = false }: CurriculumNavProps) {
  const { t } = useTranslation()
  return (
    <nav className="learn-curriculum" aria-labelledby={headingId}>
      <h2 className={headingHidden ? 'learn-sr-only' : 'learn-curriculum__title'} id={headingId}>
        {t('learn.sidebar.title')}
      </h2>
      {workspace.sections.length === 0 ? <p className="learn-muted">{t('learn.sidebar.empty')}</p> : null}
      {workspace.sections.map((section) => (
        <LevelBlock
          key={sectionKeyOf(section)}
          courseId={workspace.course.id}
          section={section}
          currentItemId={currentItemId}
          open={toggles.isOpen(sectionKeyOf(section))}
          onToggle={() => toggles.toggle(sectionKeyOf(section))}
          onPick={onPick}
        />
      ))}
    </nav>
  )
}

interface LevelBlockProps {
  courseId: string
  section: WorkspaceSection
  currentItemId: string | undefined
  open: boolean
  onToggle: () => void
  onPick?: () => void
}

function LevelBlock({ courseId, section, currentItemId, open, onToggle, onPick }: LevelBlockProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const listId = `learn-level-${sectionKeyOf(section)}`
  // The level's own counts as the server computed them (API-230, then API-234's answer).
  const { total, completed, isComplete: complete } = section.progress
  return (
    <section className="learn-level">
      <button type="button" className="learn-level__toggle" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        <StateIcon state={complete ? 'completed' : 'not_started'} label={t(complete ? 'learn.level.complete' : 'learn.level.incomplete')} />
        <span className="learn-level__name">{levelName(section, t, language)}</span>
        <span className="learn-level__count">
          <bdi dir="ltr" aria-hidden>
            {completed}/{total}
          </bdi>
          <span className="learn-sr-only">{t('learn.progress.lessons', { count: total, completed })}</span>
        </span>
        <DownOutlined className="learn-level__chevron" aria-hidden />
      </button>
      {open ? (
        <ul className="learn-level__items" id={listId}>
          {section.items.map((item) => (
            <li key={item.id}>
              <LessonLink courseId={courseId} item={item} current={item.id === currentItemId} onPick={onPick} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function LessonLink({ courseId, item, current, onPick }: { courseId: string; item: WorkspaceItem; current: boolean; onPick?: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const duration = itemDurationLabel(item, t)
  return (
    <Link
      to={`/learn/${encodeURIComponent(courseId)}/${encodeURIComponent(item.id)}`}
      className="learn-item"
      aria-current={current ? 'page' : undefined}
      data-item-id={item.id}
      onClick={onPick}
    >
      <KindIcon kind={item.kind} />
      <span className="learn-item__body">
        <span className="learn-item__title">{localizedLabel(item.title, language)}</span>
        <span className="learn-item__meta">
          <span>{t(`learn.kinds.${item.kind}`)}</span>
          {duration ? <span>{duration.clock ? <bdi dir="ltr">{duration.text}</bdi> : duration.text}</span> : null}
          {item.isRequired ? null : (
            <Tag className="learn-item__optional" bordered={false}>
              {t('learn.sidebar.optional')}
            </Tag>
          )}
        </span>
      </span>
      <StateIcon state={item.state} label={t(`learn.states.${item.state}`)} />
    </Link>
  )
}
