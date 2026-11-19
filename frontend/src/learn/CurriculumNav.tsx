// The curriculum of the course player (MOD-20 — D-R130, D-R132, D-R145): the
// levels of API-230 in the server's order, each a real button that expands or
// collapses its lessons (`aria-expanded`), with its own «n/m» and completion
// mark; every lesson of an open level is a link, the current one marked
// `aria-current="page"`. A level that opens on a date (D-R145) shows a lock
// and «يُفتح في …»: its lessons stay listed but are not links
// (`aria-disabled`). Completing an earlier level is never a condition (D-R132).
// Under the levels, the class sessions (D-R143 — ClassSessions). Shown at the
// start side of the page, or inside the drawer on a narrow screen; the
// author's preview (LearnPreviewPage) renders the same list with its own
// links, the drafts tagged and each level's release rule stated. Every state
// shown is the server's.
import { DownOutlined, LockOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { LearningWorkspace, WorkspaceItem, WorkspaceSection } from '../api/learning'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay, localizedLabel } from '../users/users.format'
import { ClassSessions } from './ClassSessions'
import type { SessionLesson } from './ClassSessions'
import { itemDurationLabel, levelName } from './learn.format'
import { isItemAvailable, isSectionOpen, learnerItemPath, sectionKeyOf } from './learn.state'
import { KindIcon, StateIcon } from './LearnIcons'
import type { LevelToggles } from './useLevelToggles'

/** What the author's preview adds to the list (LearnPreviewPage); a learner's workspace has none. */
export interface CurriculumAnnotations {
  /** The lessons that are not published (tagged «مسودّة»). */
  drafts?: ReadonlySet<string>
  /** A level's `releaseAfterDays` by its key (sectionKeyOf); absent or null = always open. */
  releaseAfterDays?: ReadonlyMap<string, number | null>
}

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
  /** Where a lesson opens; the learner's `/learn/:courseId/:itemId` by default. */
  itemPath?: (itemId: string) => string
  annotations?: CurriculumAnnotations
}

export function CurriculumNav({ workspace, currentItemId, toggles, onPick, headingId, headingHidden = false, itemPath, annotations }: CurriculumNavProps) {
  const { t } = useTranslation()
  const pathOf = itemPath ?? learnerItemPath(workspace.course.id)
  const sessions = Array.isArray(workspace.sessions) ? workspace.sessions : []
  const lessons = new Map<string, SessionLesson>(
    workspace.sections.flatMap((section) => section.items.map((item) => [item.id, { title: item.title, available: isItemAvailable(item) }] as const)),
  )
  return (
    <>
      <nav className="learn-curriculum" aria-labelledby={headingId}>
        <h2 className={headingHidden ? 'learn-sr-only' : 'learn-curriculum__title'} id={headingId}>
          {t('learn.sidebar.title')}
        </h2>
        {workspace.sections.length === 0 ? <p className="learn-muted">{t('learn.sidebar.empty')}</p> : null}
        {workspace.sections.map((section) => (
          <LevelBlock
            key={sectionKeyOf(section)}
            section={section}
            currentItemId={currentItemId}
            open={toggles.isOpen(sectionKeyOf(section))}
            onToggle={() => toggles.toggle(sectionKeyOf(section))}
            onPick={onPick}
            itemPath={pathOf}
            annotations={annotations}
          />
        ))}
      </nav>
      <ClassSessions sessions={sessions} lessons={lessons} itemPath={pathOf} idBase={`${headingId}-sessions`} onPick={onPick} />
    </>
  )
}

interface LevelBlockProps {
  section: WorkspaceSection
  currentItemId: string | undefined
  open: boolean
  onToggle: () => void
  onPick?: () => void
  itemPath: (itemId: string) => string
  annotations?: CurriculumAnnotations
}

function LevelBlock({ section, currentItemId, open, onToggle, onPick, itemPath, annotations }: LevelBlockProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const key = sectionKeyOf(section)
  const listId = `learn-level-${key}`
  // The level's own counts as the server computed them (API-230, then API-234's answer).
  const { total, completed, isComplete: complete } = section.progress
  const locked = !isSectionOpen(section)
  const releaseDays = annotations?.releaseAfterDays?.get(key) ?? null
  let note: string | null = null
  if (locked) note = section.opensOn ? t('learn.level.opensOn', { date: formatDay(section.opensOn, language) }) : t('learn.level.notOpenYet')
  else if (releaseDays !== null) note = releaseDays === 0 ? t('learn.preview.opensAtStart') : t('learn.preview.opensAfter', { count: releaseDays })
  return (
    <section className={locked ? 'learn-level learn-level--locked' : 'learn-level'}>
      <button type="button" className="learn-level__toggle" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
        {locked ? (
          <span className="learn-state learn-state--locked" role="img" aria-label={t('learn.level.locked')} title={t('learn.level.locked')}>
            <LockOutlined aria-hidden />
          </span>
        ) : (
          <StateIcon state={complete ? 'completed' : 'not_started'} label={t(complete ? 'learn.level.complete' : 'learn.level.incomplete')} />
        )}
        <span className="learn-level__label">
          <span className="learn-level__name">{levelName(section, t, language)}</span>
          {note ? <span className="learn-level__opens">{note}</span> : null}
        </span>
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
              {isItemAvailable(item) ? (
                <LessonLink
                  item={item}
                  to={itemPath(item.id)}
                  current={item.id === currentItemId}
                  draft={annotations?.drafts?.has(item.id) ?? false}
                  onPick={onPick}
                />
              ) : (
                <LockedLesson item={item} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function LessonMeta({ item, draft }: { item: WorkspaceItem; draft: boolean }) {
  const { t } = useTranslation()
  const duration = itemDurationLabel(item, t)
  return (
    <span className="learn-item__meta">
      <span>{t(`learn.kinds.${item.kind}`)}</span>
      {duration ? <span>{duration.clock ? <bdi dir="ltr">{duration.text}</bdi> : duration.text}</span> : null}
      {item.isRequired ? null : (
        <Tag className="learn-item__optional" bordered={false}>
          {t('learn.sidebar.optional')}
        </Tag>
      )}
      {draft ? (
        <Tag className="learn-item__optional" color="gold" bordered={false}>
          {t('learn.preview.draft')}
        </Tag>
      ) : null}
    </span>
  )
}

function LessonLink({ item, to, current, draft, onPick }: { item: WorkspaceItem; to: string; current: boolean; draft: boolean; onPick?: () => void }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Link to={to} className="learn-item" aria-current={current ? 'page' : undefined} data-item-id={item.id} onClick={onPick}>
      <KindIcon kind={item.kind} />
      <span className="learn-item__body">
        <span className="learn-item__title">{localizedLabel(item.title, language)}</span>
        <LessonMeta item={item} draft={draft} />
      </span>
      <StateIcon state={item.state} label={t(`learn.states.${item.state}`)} />
    </Link>
  )
}

/** A lesson of a level that is not open yet (D-R145): listed, not a link — it cannot be opened before its day. */
function LockedLesson({ item }: { item: WorkspaceItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <span className="learn-item learn-item--locked" aria-disabled="true" data-item-id={item.id}>
      <KindIcon kind={item.kind} />
      <span className="learn-item__body">
        <span className="learn-item__title">{localizedLabel(item.title, language)}</span>
        <LessonMeta item={item} draft={false} />
      </span>
      <span className="learn-state learn-state--locked" role="img" aria-label={t('learn.sidebar.locked')} title={t('learn.sidebar.locked')}>
        <LockOutlined aria-hidden />
      </span>
    </span>
  )
}
