// The «المنهج» tab of the course drawer (MOD-20, roadmap §4q — D-R130/D-R135),
// on API-226/227 (and API-228 through LessonContentModal). A course is organised
// in levels («المستوى الأول»، «المستوى الثاني» …), each holding its lessons in
// order; the lessons outside every level form one trailing group. Holders of
// `courses.manage` (the server's `canManage`) edit the whole structure — levels
// added, renamed, moved and deleted; lessons added, titled, timed, made
// required or optional, published or not, moved and deleted — and save it in
// ONE PUT, only when it differs from the stored one (curriculum.plan.ts). The
// content of each saved lesson is written on its own («المحتوى»). A lesson
// learners have progress on cannot be deleted (unpublish it instead); a
// refusal of the server (409 lesson_has_progress) puts those lessons back and
// marks them. A teacher of the course reads it; anyone else gets 404, worded
// as «available to who manages or teaches the course». While the structure
// holds unsaved work the tab reports it to the drawer (`onUnsavedChange`), so
// Escape, a mask click and a browser back keep it (KI-054/KI-055).
// LRN-T06: a new lesson starts as an unpublished draft (D-R144); «نشر المستوى»
// and «نشر الكل» switch the draft's flags only — the same single save sends
// them; «معاينة كطالب» opens the SAVED curriculum as a learner sees it in a new
// tab (/learn/:courseId/preview), so it waits for a save while the draft
// differs; a level may open some days after the class starts (D-R145); each
// lesson names the class sessions linked to it (`sessionCount`, D-R143).
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Card, Col, Empty, Flex, Form, Input, InputNumber, Popconfirm, Row, Select, Skeleton, Space, Switch, Tag, Tooltip, Typography, theme } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CURRICULUM_ITEMS_MAX, CURRICULUM_SECTIONS_MAX, CURRICULUM_TEXT_MAX, LESSON_MINUTES_MAX, getCurriculum, replaceCurriculum } from '../api/curriculum'
import type { Curriculum, CurriculumItem } from '../api/curriculum'
import { useLocalized } from '../i18n/useLocalized'
import { localizedOf } from '../courses/courses.form'
import { localizedLabel } from '../users/users.format'
import { describeCurriculumFailure, failureMessage } from './curriculum.errors'
import type { CurriculumFailure } from './curriculum.errors'
import { formatMediaDuration, levelName, previewPath, releaseLabel } from './curriculum.format'
import {
  LOOSE_GROUP,
  CURRICULUM_PROBLEM,
  addLesson,
  addLevel,
  curriculumDraftOf,
  curriculumHasChanges,
  curriculumProblems,
  draftLevelTitle,
  groupOfLesson,
  itemsOf,
  lessonCount,
  moveLesson,
  moveLessonTo,
  moveLevel,
  newDraftKey,
  planCurriculumSave,
  problemKey,
  publishAll,
  publishLevel,
  removeLesson,
  removeLevel,
  restoreLessons,
  unpublishedCount,
  updateLesson,
  updateLevel,
  withItem,
} from './curriculum.plan'
import type { CurriculumDraft, DraftProblem, LessonDraft, LessonPatch, LevelDraft, LevelPatch } from './curriculum.plan'
import { LessonContentModal } from './LessonContentModal'

interface CurriculumTabProps {
  courseId: string
  /** Whether the structure differs from the stored one (KI-054): the course drawer then keeps Escape and a mask click from dropping it. */
  onUnsavedChange?: (unsaved: boolean) => void
}

type Notice = { type: 'error' | 'warning'; text: string }

export function CurriculumTab({ courseId, onUnsavedChange }: CurriculumTabProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [saved, setSaved] = useState<Curriculum | null>(null)
  const [draft, setDraft] = useState<CurriculumDraft | null>(null)
  const [loadFailure, setLoadFailure] = useState<CurriculumFailure | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** Lessons the server refused to delete (409 lesson_has_progress): marked until the next save. */
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())
  const [contentItem, setContentItem] = useState<{ item: CurriculumItem; title: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getCurriculum(courseId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setSaved(loaded)
        setDraft(curriculumDraftOf(loaded))
        setLoadFailure(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadFailure(describeCurriculumFailure(error))
      })
    return () => controller.abort()
  }, [courseId, reloadTick])

  const reload = useCallback(() => {
    setLoadFailure(null)
    setReloadTick((tick) => tick + 1)
  }, [])

  const unsaved = saved !== null && draft !== null && saved.canManage && curriculumHasChanges(saved, draft)

  useEffect(() => {
    onUnsavedChange?.(unsaved)
  }, [unsaved, onUnsavedChange])
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange])

  const edit = useCallback((change: (current: CurriculumDraft) => CurriculumDraft) => setDraft((current) => (current ? change(current) : current)), [])

  const save = async () => {
    if (!saved || !draft) return
    const problems = curriculumProblems(draft)
    if (problems.size > 0) {
      setShowErrors(true)
      setNotice({ type: 'error', text: t('curriculum.fixErrors') })
      return
    }
    const body = planCurriculumSave(saved, draft)
    if (!body) {
      message.info(t('curriculum.nothingChanged'))
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const next = await replaceCurriculum(courseId, body)
      setSaved(next)
      setDraft(curriculumDraftOf(next))
      setShowErrors(false)
      setRefused(new Set())
      message.success(t('curriculum.saved'))
    } catch (caught) {
      const failure = describeCurriculumFailure(caught)
      if (failure.code === 'lesson_has_progress') {
        const itemIds = failure.itemIds ?? []
        setDraft((current) => (current ? restoreLessons(current, saved, itemIds) : current))
        setRefused((current) => new Set([...current, ...itemIds]))
        setNotice({ type: 'warning', text: t('curriculum.progressRestored') })
      } else if (failure.code === 'curriculum_invalid' || failure.code === 'course_not_found') {
        // Changed elsewhere meanwhile (a level or lesson is gone): show the curriculum as the server holds it now.
        message.error(failureMessage(t, failure))
        reload()
      } else {
        setNotice({ type: 'error', text: failureMessage(t, failure) })
      }
    } finally {
      setSaving(false)
    }
  }

  const discard = () => {
    if (!saved) return
    setDraft(curriculumDraftOf(saved))
    setShowErrors(false)
    setNotice(null)
  }

  if (loadFailure) {
    if (loadFailure.code === 'course_not_found') return <Alert type="info" showIcon title={t('curriculum.notAvailable')} />
    return (
      <Alert
        type="error"
        showIcon
        title={t('curriculum.loadError')}
        description={failureMessage(t, loadFailure)}
        action={
          <Button size="small" onClick={reload}>
            {t('curriculum.retry')}
          </Button>
        }
      />
    )
  }
  if (!saved || !draft) return <Skeleton active paragraph={{ rows: 5 }} data-testid="curriculum-loading" />

  if (!saved.canManage) return <CurriculumView curriculum={saved} />

  return (
    <>
      <CurriculumEditor
        saved={saved}
        draft={draft}
        unsaved={unsaved}
        saving={saving}
        showErrors={showErrors}
        refused={refused}
        notice={notice}
        onNoticeClose={() => setNotice(null)}
        edit={edit}
        onSave={() => void save()}
        onDiscard={discard}
        onOpenContent={(item, title) => setContentItem({ item, title })}
      />
      {contentItem ? (
        <LessonContentModal
          // Mounted per session, so every session starts from the lesson as the server holds it (KI-049).
          key={`${contentItem.item.id}:${contentItem.item.updatedAt}`}
          courseId={courseId}
          item={contentItem.item}
          title={contentItem.title}
          onSaved={(item) => {
            setSaved((current) => (current ? withItem(current, item) : current))
            setContentItem(null)
          }}
          onClose={() => setContentItem(null)}
        />
      ) : null}
    </>
  )
}

// --- The read-only view (a teacher of the course) ---------------------------

function CurriculumView({ curriculum }: { curriculum: Curriculum }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const items = itemsOf(curriculum)
  // Numbered in learning order across the levels.
  const numbers = new Map(items.map((item, index) => [item.id, index + 1]))
  const lessonRows = (lessons: CurriculumItem[]) =>
    lessons.length === 0 ? (
      <Typography.Text type="secondary">{t('curriculum.level.empty')}</Typography.Text>
    ) : (
      <Flex vertical gap={6}>
        {lessons.map((item) => (
          <Flex key={item.id} gap={8} wrap align="center" data-testid="curriculum-view-lesson">
            <Typography.Text type="secondary">{t('curriculum.lesson.number', { number: numbers.get(item.id) })}</Typography.Text>
            <Typography.Text strong>{localizedLabel(item.title, language)}</Typography.Text>
            <LessonTags item={item} isRequired={item.isRequired} isPublished={item.isPublished} />
          </Flex>
        ))}
      </Flex>
    )

  return (
    <Flex vertical gap={12}>
      <Alert type="info" showIcon title={t('curriculum.readOnly')} />
      {items.length === 0 && curriculum.sections.length === 0 ? <Empty description={t('curriculum.empty')} /> : null}
      {curriculum.sections.map((section) => (
        <Card
          key={section.id}
          size="small"
          title={
            <Space size={6} wrap>
              <span>{levelName(t, language, section.number, section.title)}</span>
              <ReleaseTag days={section.releaseAfterDays ?? null} />
            </Space>
          }
          data-testid="curriculum-level"
        >
          {section.description ? <Typography.Paragraph type="secondary">{localizedLabel(section.description, language)}</Typography.Paragraph> : null}
          {lessonRows(section.items)}
        </Card>
      ))}
      {curriculum.looseItems.length > 0 ? (
        <Card size="small" title={curriculum.sections.length > 0 ? t('curriculum.loose.title') : t('curriculum.loose.only')} data-testid="curriculum-loose">
          {lessonRows(curriculum.looseItems)}
        </Card>
      ) : null}
    </Flex>
  )
}

/**
 * Kind, length, linked sessions and state of a lesson: the stored lesson's kind, content and sessions (`item` —
 * absent for a lesson not saved yet, which has no content), and the required/published state as shown — the
 * draft's in the editor, so «نشر المستوى» clears «غير منشور» at once.
 */
function LessonTags({ item, isRequired, isPublished }: { item: CurriculumItem | undefined; isRequired: boolean; isPublished: boolean }) {
  const { t } = useTranslation()
  const sessions = item?.sessionCount ?? 0
  return (
    <Space size={4} wrap>
      {item ? <Tag>{t(`curriculum.kinds.${item.kind}`)}</Tag> : null}
      {!item || (item.content === null && item.kind !== 'live') ? <Tag color="warning">{t('curriculum.noContent')}</Tag> : null}
      {item && item.completionMode !== 'manual' ? <Tag color="geekblue">{t(`curriculum.completion.${item.completionMode}`)}</Tag> : null}
      {item && item.durationSeconds !== null ? (
        <Tag>
          <bdi dir="ltr">{formatMediaDuration(item.durationSeconds)}</bdi>
        </Tag>
      ) : null}
      {sessions > 0 ? (
        <Tag color="cyan" title={t('curriculum.lesson.sessionCountTitle')} data-testid="curriculum-session-count">
          {t('curriculum.lesson.sessionCount', { count: sessions })}
        </Tag>
      ) : null}
      {isRequired ? null : <Tag color="default">{t('curriculum.lesson.optional')}</Tag>}
      {isPublished ? null : <Tag color="orange">{t('curriculum.lesson.unpublished')}</Tag>}
    </Space>
  )
}

/** When a level opens for a learner (D-R145); nothing for a level open at once. */
function ReleaseTag({ days }: { days: number | null }) {
  const { t } = useTranslation()
  const label = releaseLabel(t, days)
  return label ? (
    <Tag color="gold" icon={<LockOutlined />} data-testid="curriculum-release">
      {label}
    </Tag>
  ) : null
}

// --- The editor (`courses.manage`) -------------------------------------------

interface CurriculumEditorProps {
  saved: Curriculum
  draft: CurriculumDraft
  unsaved: boolean
  saving: boolean
  showErrors: boolean
  refused: ReadonlySet<string>
  notice: Notice | null
  onNoticeClose: () => void
  edit: (change: (current: CurriculumDraft) => CurriculumDraft) => void
  onSave: () => void
  onDiscard: () => void
  onOpenContent: (item: CurriculumItem, title: string) => void
}

function CurriculumEditor({ saved, draft, unsaved, saving, showErrors, refused, notice, onNoticeClose, edit, onSave, onDiscard, onOpenContent }: CurriculumEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const savedItems = useMemo(() => new Map(itemsOf(saved).map((item) => [item.id, item])), [saved])
  const problems = useMemo(() => (showErrors ? curriculumProblems(draft) : new Map<string, DraftProblem>()), [draft, showErrors])
  const total = lessonCount(draft)
  const atLessonLimit = total >= CURRICULUM_ITEMS_MAX
  const atLevelLimit = draft.levels.length >= CURRICULUM_SECTIONS_MAX
  const unpublished = unpublishedCount(draft)
  const showsLoose = draft.loose.length > 0 || draft.levels.length === 0
  const looseTitle = draft.levels.length > 0 ? t('curriculum.loose.title') : t('curriculum.loose.only')

  /** A lesson learners have progress on: it can be unpublished, never deleted (D-R135). */
  const deleteBlocked = (lesson: LessonDraft) => lesson.id !== undefined && ((savedItems.get(lesson.id)?.progressCount ?? 0) > 0 || refused.has(lesson.id))
  const nameOfLevel = (level: LevelDraft, index: number) => levelName(t, language, index + 1, draftLevelTitle(level))
  const moveTargets = [
    ...draft.levels.map((level, index) => ({ value: level.key, label: nameOfLevel(level, index) })),
    { value: LOOSE_GROUP, label: t('curriculum.loose.moveTarget') },
  ]
  const problemText = (draftKey: string, field: string): string | undefined => {
    const problem = problems.get(problemKey(draftKey, field))
    return problem ? t(problem.key, problem.params) : undefined
  }

  // Lessons are numbered in learning order across the levels (levels in order, then the loose ones).
  const numbers = new Map([...draft.levels.flatMap((level) => level.lessons), ...draft.loose].map((lesson, index) => [lesson.key, index + 1]))
  const lessonEditor = (lesson: LessonDraft, index: number, group: readonly LessonDraft[]) => {
    const item = lesson.id ? savedItems.get(lesson.id) : undefined
    return (
      <LessonEditor
        key={lesson.key}
        lesson={lesson}
        item={item}
        number={numbers.get(lesson.key) ?? index + 1}
        first={index === 0}
        last={index === group.length - 1}
        groupKey={groupOfLesson(draft, lesson.key) ?? LOOSE_GROUP}
        moveTargets={moveTargets}
        blocked={deleteBlocked(lesson)}
        refused={lesson.id !== undefined && refused.has(lesson.id)}
        problemText={(field) => problemText(lesson.key, field)}
        onChange={(patch) => edit((current) => updateLesson(current, lesson.key, patch))}
        onMove={(delta) => edit((current) => moveLesson(current, lesson.key, delta))}
        onMoveTo={(target) => edit((current) => moveLessonTo(current, lesson.key, target))}
        onRemove={() => edit((current) => removeLesson(current, lesson.key))}
        onOpenContent={item ? () => onOpenContent(item, localizedLabel(localizedOf(lesson.titleAr, lesson.titleEn) ?? item.title, language)) : undefined}
      />
    )
  }

  const addLessonButton = (groupKey: string) => (
    <Button
      type="dashed"
      icon={<PlusOutlined />}
      onClick={() => edit((current) => addLesson(current, groupKey, newDraftKey()))}
      disabled={atLessonLimit}
      title={atLessonLimit ? t('curriculum.lesson.maxReached', { max: CURRICULUM_ITEMS_MAX }) : undefined}
      style={{ alignSelf: 'flex-start' }}
    >
      {t('curriculum.lesson.add')}
    </Button>
  )

  const structureProblem = problems.get(CURRICULUM_PROBLEM)

  return (
    <Form layout="vertical" component={false} disabled={saving}>
      <Flex vertical gap={12}>
        <Flex
          justify="space-between"
          align="center"
          wrap
          gap={8}
          // Sticks over the drawer body's own top padding too: with `top: 0` the lesson fields showed through that strip when
          // scrolled (MOD-20 acceptance). The negative margin takes back the tab bar's bottom margin, so the unscrolled
          // toolbar sits where it did, 8 px lower at most.
          style={{
            position: 'sticky',
            top: -token.paddingLG,
            zIndex: 3,
            background: token.colorBgElevated,
            marginBlockStart: -token.margin,
            paddingBlockStart: token.paddingLG + 8,
            paddingBlockEnd: 8,
          }}
          data-testid="curriculum-toolbar"
        >
          <Space orientation="vertical" size={0}>
            <Typography.Text type="secondary">
              {t('curriculum.summary', { levels: t('curriculum.levelCount', { count: draft.levels.length }), lessons: t('curriculum.lessonCount', { count: total }) })}
            </Typography.Text>
            {unsaved ? <Typography.Text type="warning">{t('curriculum.unsavedHint')}</Typography.Text> : null}
            {unsaved ? (
              <Typography.Text type="secondary" id="curriculum-preview-hint" data-testid="curriculum-preview-hint">
                {t('curriculum.previewSaveFirst')}
              </Typography.Text>
            ) : null}
          </Space>
          <Space wrap>
            {/* The learner's view of the SAVED curriculum (D-R144): a draft that differs is not what it would show. */}
            <Tooltip title={unsaved ? t('curriculum.previewSaveFirst') : t('curriculum.previewHint')}>
              <span>
                <Button icon={<EyeOutlined />} href={previewPath(saved.courseId)} target="_blank" rel="noopener noreferrer" disabled={unsaved || saving} aria-describedby={unsaved ? 'curriculum-preview-hint' : undefined}>
                  {t('curriculum.preview')}
                </Button>
              </span>
            </Tooltip>
            <Button
              icon={<CloudUploadOutlined />}
              onClick={() => edit(publishAll)}
              disabled={unpublished === 0}
              title={unpublished === 0 ? t('curriculum.allPublished') : undefined}
            >
              {t('curriculum.publishAll')}
            </Button>
            <Popconfirm title={t('curriculum.discardConfirm')} okText={t('curriculum.discard')} cancelText={t('common.cancel')} onConfirm={onDiscard} disabled={!unsaved || saving}>
              <Button icon={<UndoOutlined />} disabled={!unsaved || saving}>
                {t('curriculum.discard')}
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<SaveOutlined />} onClick={onSave} disabled={!unsaved} loading={saving}>
              {t('curriculum.save')}
            </Button>
          </Space>
        </Flex>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('curriculum.intro')}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} data-testid="curriculum-publish-hint">
          {t('curriculum.publishHint')}
        </Typography.Paragraph>
        {notice ? <Alert type={notice.type} showIcon title={notice.text} closable={{ onClose: onNoticeClose }} /> : null}
        {structureProblem ? <Alert type="error" showIcon title={t(structureProblem.key, structureProblem.params)} /> : null}
        {draft.levels.length === 0 && draft.loose.length === 0 ? <Empty description={t('curriculum.emptyManager')} /> : null}

        {draft.levels.map((level, index) => {
          const name = nameOfLevel(level, index)
          const levelBlocked = level.lessons.some(deleteBlocked)
          const levelUnpublished = unpublishedCount(draft, level.key)
          const removeButton = (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t('curriculum.level.remove')}
              disabled={levelBlocked}
              onClick={level.lessons.length === 0 ? () => edit((current) => removeLevel(current, level.key)) : undefined}
            />
          )
          return (
            <Card
              key={level.key}
              size="small"
              data-testid="curriculum-level"
              title={
                <Space size={6} wrap>
                  <span>{name}</span>
                  {level.id ? null : <Tag color="blue">{t('curriculum.newEntry')}</Tag>}
                  <ReleaseTag days={level.releaseAfterDays} />
                </Space>
              }
              extra={
                <Space size={4} wrap>
                  {/* Switches the draft only (D-R144): «حفظ المنهج» sends it with the rest. */}
                  <Button
                    size="small"
                    icon={<CloudUploadOutlined />}
                    disabled={levelUnpublished === 0}
                    title={levelUnpublished === 0 ? t('curriculum.level.allPublished') : undefined}
                    onClick={() => edit((current) => publishLevel(current, level.key))}
                  >
                    {t('curriculum.level.publish')}
                  </Button>
                  <Button size="small" icon={<ArrowUpOutlined />} aria-label={t('curriculum.level.moveUp')} disabled={index === 0} onClick={() => edit((current) => moveLevel(current, level.key, -1))} />
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    aria-label={t('curriculum.level.moveDown')}
                    disabled={index === draft.levels.length - 1}
                    onClick={() => edit((current) => moveLevel(current, level.key, 1))}
                  />
                  {levelBlocked ? (
                    <Tooltip title={t('curriculum.level.removeBlocked')}>
                      <span>{removeButton}</span>
                    </Tooltip>
                  ) : level.lessons.length > 0 ? (
                    <Popconfirm
                      title={t('curriculum.level.removeConfirm', { name, lessons: t('curriculum.lessonCount', { count: level.lessons.length }) })}
                      okText={t('curriculum.level.remove')}
                      okButtonProps={{ danger: true }}
                      cancelText={t('common.cancel')}
                      onConfirm={() => edit((current) => removeLevel(current, level.key))}
                    >
                      {removeButton}
                    </Popconfirm>
                  ) : (
                    removeButton
                  )}
                </Space>
              }
            >
              <LevelFields level={level} problemText={(field) => problemText(level.key, field)} onChange={(patch) => edit((current) => updateLevel(current, level.key, patch))} />
              <Flex vertical gap={8}>
                {level.lessons.length === 0 ? <Typography.Text type="secondary">{t('curriculum.level.empty')}</Typography.Text> : null}
                {level.lessons.map((lesson, lessonIndex) => lessonEditor(lesson, lessonIndex, level.lessons))}
                {addLessonButton(level.key)}
              </Flex>
            </Card>
          )
        })}

        {showsLoose ? (
          <Card size="small" title={looseTitle} data-testid="curriculum-loose">
            <Flex vertical gap={8}>
              {draft.loose.map((lesson, lessonIndex) => lessonEditor(lesson, lessonIndex, draft.loose))}
              {addLessonButton(LOOSE_GROUP)}
            </Flex>
          </Card>
        ) : null}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={() => edit((current) => addLevel(current, newDraftKey()))}
          disabled={atLevelLimit}
          title={atLevelLimit ? t('curriculum.level.maxReached', { max: CURRICULUM_SECTIONS_MAX }) : undefined}
        >
          {t('curriculum.level.add')}
        </Button>
      </Flex>
    </Form>
  )
}

/**
 * The fields of one level: an optional title and description (Arabic first), and when it opens — the days after the
 * learner's class starts (D-R145), empty = at once. No InputNumber min/max/precision: antd would clamp or round a
 * typed value silently on blur; the check before the save words it instead (curriculumProblems — 0..365, whole).
 */
function LevelFields({ level, problemText, onChange }: { level: LevelDraft; problemText: (field: string) => string | undefined; onChange: (patch: LevelPatch) => void }) {
  const { t } = useTranslation()
  const releaseId = `curriculum-${level.key}-releaseAfterDays`
  const releaseError = problemText('releaseAfterDays')
  const field = (name: 'titleAr' | 'titleEn' | 'descriptionAr' | 'descriptionEn', multiline: boolean): ReactNode => {
    const id = `curriculum-${level.key}-${name}`
    const error = problemText(name)
    const ltr = name.endsWith('En')
    const props = { id, value: level[name], maxLength: CURRICULUM_TEXT_MAX, dir: ltr ? 'ltr' : undefined, onChange: (event: { target: { value: string } }) => onChange({ [name]: event.target.value }) }
    return (
      <Form.Item label={t(`curriculum.level.fields.${name}`)} htmlFor={id} validateStatus={error ? 'error' : undefined} help={error} style={{ marginBottom: 8 }}>
        {multiline ? <Input.TextArea rows={1} {...props} /> : <Input {...props} />}
      </Form.Item>
    )
  }
  return (
    <Row gutter={12}>
      {/* Arabic only on screen; a stored English text stays as it is (the draft keeps it). */}
      <Col xs={24}>
        {field('titleAr', false)}
      </Col>
      {/* Arabic only on screen; a stored English text stays as it is (the draft keeps it). */}
      <Col xs={24}>
        {field('descriptionAr', true)}
      </Col>
      <Col xs={24}>
        <Form.Item
          label={t('curriculum.level.releaseAfterDays')}
          htmlFor={releaseId}
          validateStatus={releaseError ? 'error' : undefined}
          help={releaseError}
          extra={t('curriculum.level.releaseHint')}
          style={{ marginBottom: 8 }}
        >
          <InputNumber
            id={releaseId}
            step={1}
            value={level.releaseAfterDays}
            placeholder={t('curriculum.level.releasePlaceholder')}
            onChange={(value) => onChange({ releaseAfterDays: typeof value === 'number' ? value : null })}
            style={{ width: 140 }}
          />
        </Form.Item>
      </Col>
    </Row>
  )
}

interface LessonEditorProps {
  lesson: LessonDraft
  /** The stored lesson (absent for a new one). */
  item: CurriculumItem | undefined
  number: number
  first: boolean
  last: boolean
  groupKey: string
  moveTargets: { value: string; label: string }[]
  /** Learners have progress on it: no delete. */
  blocked: boolean
  /** Put back after the server refused to delete it. */
  refused: boolean
  problemText: (field: string) => string | undefined
  onChange: (patch: LessonPatch) => void
  onMove: (delta: -1 | 1) => void
  onMoveTo: (groupKey: string) => void
  onRemove: () => void
  /** Present for a saved lesson only: a new one gets its content once the structure is saved. */
  onOpenContent: (() => void) | undefined
}

function LessonEditor({ lesson, item, number, first, last, groupKey, moveTargets, blocked, refused, problemText, onChange, onMove, onMoveTo, onRemove, onOpenContent }: LessonEditorProps) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const id = (name: string) => `curriculum-${lesson.key}-${name}`
  const text = (name: 'titleAr' | 'titleEn' | 'descriptionAr' | 'descriptionEn', multiline: boolean) => {
    const error = problemText(name)
    const props = {
      id: id(name),
      value: lesson[name],
      maxLength: CURRICULUM_TEXT_MAX,
      dir: name.endsWith('En') ? 'ltr' : undefined,
      onChange: (event: { target: { value: string } }) => onChange({ [name]: event.target.value }),
    }
    return (
      <Form.Item label={t(`curriculum.lesson.fields.${name}`)} htmlFor={id(name)} validateStatus={error ? 'error' : undefined} help={error} style={{ marginBottom: 8 }}>
        {multiline ? <Input.TextArea rows={1} {...props} /> : <Input {...props} />}
      </Form.Item>
    )
  }
  const minutesError = problemText('estimatedMinutes')
  const blockedHintId = id('blocked')
  const contentButton = (
    <Button size="small" icon={<FileTextOutlined />} onClick={onOpenContent} disabled={!onOpenContent}>
      {t('curriculum.lesson.content')}
    </Button>
  )

  return (
    <div
      data-testid="curriculum-lesson"
      data-refused={refused ? 'true' : undefined}
      style={{
        border: `1px solid ${refused ? token.colorError : token.colorBorderSecondary}`,
        background: refused ? token.colorErrorBg : undefined,
        borderRadius: token.borderRadius,
        padding: 12,
      }}
    >
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8 }}>
        <Space size={4} wrap>
          <Typography.Text strong>{t('curriculum.lesson.number', { number })}</Typography.Text>
          {item ? null : <Tag color="blue">{t('curriculum.newEntry')}</Tag>}
          <LessonTags item={item} isRequired={lesson.isRequired} isPublished={lesson.isPublished} />
          {item && item.progressCount > 0 ? <Tag color="purple">{t('curriculum.lesson.progressCount', { count: item.progressCount })}</Tag> : null}
          {refused ? <Tag color="red">{t('curriculum.lesson.refused')}</Tag> : null}
        </Space>
        <Space size={4} wrap>
          {onOpenContent ? contentButton : <Tooltip title={t('curriculum.lesson.contentNeedsSave')}>{contentButton}</Tooltip>}
          <Button size="small" icon={<ArrowUpOutlined />} aria-label={t('curriculum.lesson.moveUp')} disabled={first} onClick={() => onMove(-1)} />
          <Button size="small" icon={<ArrowDownOutlined />} aria-label={t('curriculum.lesson.moveDown')} disabled={last} onClick={() => onMove(1)} />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label={t('curriculum.lesson.remove')}
            aria-describedby={blocked ? blockedHintId : undefined}
            disabled={blocked}
            onClick={onRemove}
          />
        </Space>
      </Flex>
      {onOpenContent ? null : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t('curriculum.lesson.contentNeedsSave')}
        </Typography.Paragraph>
      )}
      <Row gutter={12}>
        {/* Arabic only on screen; a stored English text stays as it is (the draft keeps it). */}
        <Col xs={24}>
          {text('titleAr', false)}
        </Col>
        {/* Arabic only on screen; a stored English text stays as it is (the draft keeps it). */}
        <Col xs={24}>
          {text('descriptionAr', true)}
        </Col>
      </Row>
      <Flex wrap gap={16} align="flex-end">
        <Form.Item
          label={t('curriculum.lesson.fields.estimatedMinutes')}
          htmlFor={id('estimatedMinutes')}
          validateStatus={minutesError ? 'error' : undefined}
          help={minutesError}
          style={{ marginBottom: 0 }}
        >
          <InputNumber
            id={id('estimatedMinutes')}
            min={1}
            max={LESSON_MINUTES_MAX}
            precision={0}
            value={lesson.estimatedMinutes}
            onChange={(value) => onChange({ estimatedMinutes: typeof value === 'number' ? value : null })}
            style={{ width: 140 }}
          />
        </Form.Item>
        <Form.Item label={t('curriculum.lesson.fields.required')} htmlFor={id('required')} style={{ marginBottom: 0 }}>
          <Switch id={id('required')} checked={lesson.isRequired} onChange={(checked) => onChange({ isRequired: checked })} />
        </Form.Item>
        <Form.Item label={t('curriculum.lesson.fields.published')} htmlFor={id('published')} style={{ marginBottom: 0 }}>
          <Switch id={id('published')} checked={lesson.isPublished} onChange={(checked) => onChange({ isPublished: checked })} />
        </Form.Item>
        <Form.Item label={t('curriculum.lesson.fields.moveTo')} htmlFor={id('moveTo')} style={{ marginBottom: 0, minWidth: 200 }}>
          <Select id={id('moveTo')} value={groupKey} options={moveTargets} onChange={(target: string) => onMoveTo(target)} popupMatchSelectWidth={false} />
        </Form.Item>
      </Flex>
      {blocked ? (
        <Typography.Text id={blockedHintId} type="secondary" style={{ display: 'block', marginTop: 8 }}>
          {t('curriculum.lesson.removeBlocked')}
        </Typography.Text>
      ) : null}
    </div>
  )
}
