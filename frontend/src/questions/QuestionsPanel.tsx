// The questions of the bank on screen (MOD-09 phase 2 — OEX-T07): GET
// /api/questions?bankId=… (API-265) with text, type, status, difficulty and tag
// filters and keyset pages; the editor for a new or an existing question; and
// the row actions — make ready / back to draft / archive / restore (a PATCH of
// `status`, API-268) and delete (API-269) behind a confirmation. The page
// mounts it per bank (`key`), so every bank starts from its first page and the
// heading takes the focus when the bank is chosen. «Edit» reads the question
// again first (API-267): a bank is shared by the teachers of its course, and a
// page left open for an hour would start the editor from an old row — the
// editor starts from what the server holds now, and a question that is gone is
// said so before anything is typed.
//
// What the server would refuse is said before the click: «make it ready» is off
// for a question the server lists as incomplete (`missing`), «delete» for a
// question an exam links (`examCount`) — both reasons are in the row itself.
// A refusal that comes anyway (the row was stale) is worded above the table and
// the list is re-read. No optimism: a written row shows the server's answer,
// and a row whose new status leaves the list on screen goes with a re-read.
// Every write tells the page, which re-reads the bank's counts.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { QUESTION_DIFFICULTIES, QUESTION_STATUSES, QUESTION_TAG_MAX_LENGTH, QUESTION_TYPES, deleteQuestion, getQuestion, updateQuestion } from '../api/questionBanks'
import type { Question, QuestionBank } from '../api/questionBanks'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { QuestionEditor } from './QuestionEditor'
import { describeQuestionsFailure, failureMessage, isQuestionsFailure } from './questions.errors'
import { QUESTION_STATUS_COLORS, isIncomplete, isLinkedToExams, matchesStatusFilter, promptExcerpt, statusActionsOf, statusOfAction } from './questions.format'
import type { QuestionStatusAction } from './questions.format'
import { QUESTION_PAGE_SIZES, defaultQuestionFilters, hasActiveQuestionFilters, useQuestionsList } from './useQuestionsList'
import type { QuestionsListFilters } from './useQuestionsList'
import { useReturnFocus } from './useReturnFocus'

const EMPTY = '—'

/** A refusal that says the row on screen is no longer what the server holds: the list is read again. */
const STALE_ROW_CODES = ['question_not_found', 'question_in_use', 'question_invalid']

/** The prompt on two lines at most; a plain element, so `dir="auto"` reads an English prompt left to right. */
const PROMPT_STYLE: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  fontWeight: 600,
}

interface QuestionsPanelProps {
  bank: QuestionBank
  /** Moves each time the bank's questions are asked for — also for the bank already on screen: the heading takes the focus again. */
  revealKey: number
  /** A question was written: the bank's counts on the server moved. */
  onBankChanged: () => void
  /** The bank is gone or out of reach (404): the page re-reads its banks. */
  onBankGone: () => void
}

export function QuestionsPanel({ bank, revealKey, onBankChanged, onBankGone }: QuestionsPanelProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [defaults] = useState(() => defaultQuestionFilters(bank.id))
  const list = useQuestionsList(defaults)
  const [editing, setEditing] = useState<Question | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  // The question «edit» is reading again before its editor opens.
  const [opening, setOpening] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  // The bank went away while the editor was open: the page is told once the editor closes, so its text can still be copied.
  const bankGone = useRef(false)
  const focus = useReturnFocus()

  const newQuestion = () => {
    focus.remember()
    setEditing('new')
  }

  /** The editor left the page: the focus goes back to the button that opened it, or to the heading when that button is gone. */
  const closeEditor = () => {
    setEditing(null)
    focus.giveBack(heading.current)
  }

  // The bank's questions were asked for: they take the focus and come into view (they sit below the banks).
  useEffect(() => {
    const node = heading.current
    if (!node) return
    node.focus({ preventScroll: true })
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [revealKey])

  const bankName = localizedLabel(bank.name, language)
  const promptOf = (question: Question) => localizedLabel(question.prompt, language)
  const missingOf = (question: Question) => question.missing.map((problem) => t(`questionBanks.missing.${problem}`)).join(t('questionBanks.questions.listSeparator'))

  /** Back to the first page with a fresh read: the newest question comes first. */
  const showFirstPage = () => {
    list.setFilters({})
    list.reload()
  }

  /** A refused request: its words above the table, and — when the row was stale — the list as the server holds it now. */
  const refused = (caught: unknown) => {
    const failure = describeQuestionsFailure(caught)
    setNotice(failureMessage(t, failure))
    if (isQuestionsFailure(failure, 'question_bank_not_found')) onBankGone()
    else if (STALE_ROW_CODES.some((code) => isQuestionsFailure(failure, code))) list.reload()
  }

  /** «Edit»: the editor starts from the question as the server holds it now, and so does its row. */
  const editQuestion = async (row: Question) => {
    focus.remember()
    setOpening(row.id)
    setNotice(null)
    try {
      const fresh = await getQuestion(row.id)
      list.replaceItem(fresh)
      setEditing(fresh)
    } catch (caught) {
      refused(caught)
    } finally {
      setOpening(null)
    }
  }

  /** The row as the server answered it; a status that leaves the list on screen takes the row away with a re-read. */
  const applyUpdate = (updated: Question) => {
    list.replaceItem(updated)
    if (!matchesStatusFilter(updated.status, list.filters.status)) list.reload()
    onBankChanged()
  }

  const changeStatus = async (question: Question, action: QuestionStatusAction) => {
    setBusy(true)
    setNotice(null)
    try {
      const updated = await updateQuestion(question.id, { status: statusOfAction(question, action) })
      // The words follow the status the server answered with (a restore lands on ready or on draft).
      message.success(t(action === 'restore' ? `questionBanks.questions.done.restored.${updated.status}` : `questionBanks.questions.done.${action}`))
      applyUpdate(updated)
    } catch (caught) {
      refused(caught)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (question: Question) => {
    setBusy(true)
    setNotice(null)
    try {
      await deleteQuestion(question.id)
      message.success(t('questionBanks.questions.done.deleted'))
      // The last row of the page: read the page again rather than show an empty table.
      if (list.items.length <= 1) list.reload()
      else list.removeItem(question.id)
      onBankChanged()
    } catch (caught) {
      refused(caught)
    } finally {
      setBusy(false)
    }
  }

  // One thing at a time: while a write runs or a question is being read for its editor, the other row buttons wait.
  const locked = busy || opening !== null

  const statusButton = (question: Question, action: QuestionStatusAction, name: string) => {
    const label = t(`questionBanks.questions.actions.${action}`)
    const ariaLabel = `${label}: ${name}`
    if (action === 'markReady' && isIncomplete(question)) {
      return (
        // A disabled button swallows the pointer events, so the reason sits on a wrapper.
        <Tooltip key={action} title={t('questionBanks.questions.actions.incompleteHint')}>
          <span>
            <Button size="small" aria-label={ariaLabel} disabled>
              {label}
            </Button>
          </span>
        </Tooltip>
      )
    }
    if (action === 'archive') {
      return (
        <Popconfirm
          key={action}
          title={t('questionBanks.questions.actions.archiveConfirm')}
          okText={label}
          cancelText={t('common.cancel')}
          onConfirm={() => changeStatus(question, action)}
        >
          <Button size="small" aria-label={ariaLabel} disabled={locked}>
            {label}
          </Button>
        </Popconfirm>
      )
    }
    return (
      <Button key={action} size="small" aria-label={ariaLabel} disabled={locked} onClick={() => void changeStatus(question, action)}>
        {label}
      </Button>
    )
  }

  const columns: TableProps<Question>['columns'] = [
    {
      title: t('questionBanks.questions.columns.question'),
      key: 'question',
      render: (_, row) => (
        <div style={{ minWidth: 220, maxWidth: 520 }}>
          <div dir="auto" style={PROMPT_STYLE} data-testid="question-prompt">
            {promptOf(row)}
          </div>
          {row.tags.length > 0 ? (
            <Flex wrap gap={4} style={{ marginTop: 6 }}>
              {row.tags.map((tag) => (
                <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                  <bdi>{tag}</bdi>
                </Tag>
              ))}
            </Flex>
          ) : null}
          {isIncomplete(row) ? (
            <Typography.Text type="warning" style={{ display: 'block', fontSize: 12, marginTop: 4 }} data-testid="question-missing">
              {t('questionBanks.questions.incomplete', { list: missingOf(row) })}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    { title: t('questionBanks.questions.columns.type'), key: 'type', render: (_, row) => <Tag>{t(`questionBanks.typesShort.${row.type}`)}</Tag> },
    {
      title: t('questionBanks.questions.columns.status'),
      key: 'status',
      render: (_, row) => <Tag color={QUESTION_STATUS_COLORS[row.status]}>{t(`questionBanks.statuses.${row.status}`)}</Tag>,
    },
    { title: t('questionBanks.questions.columns.points'), key: 'points', render: (_, row) => <bdi dir="ltr">{row.points}</bdi> },
    {
      title: t('questionBanks.questions.columns.difficulty'),
      key: 'difficulty',
      render: (_, row) => (row.difficulty ? t(`questionBanks.difficulties.${row.difficulty}`) : EMPTY),
    },
    {
      title: t('questionBanks.questions.columns.usage'),
      key: 'usage',
      render: (_, row) =>
        isLinkedToExams(row) ? t('questionBanks.questions.usedIn', { count: row.examCount }) : <Typography.Text type="secondary">{t('questionBanks.questions.notUsed')}</Typography.Text>,
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const name = promptExcerpt(promptOf(row))
        const deleteLabel = t('questionBanks.questions.actions.delete')
        return (
          // Wide enough for two buttons a line: the table's automatic layout would squeeze the cell to one button,
          // stacking all four and growing every row to ~140 px (the question column keeps its width the same way).
          <Space size={4} wrap data-testid="question-actions" style={{ minWidth: 190 }}>
            <Button
              size="small"
              type="primary"
              ghost
              aria-label={`${t('common.edit')}: ${name}`}
              loading={opening === row.id}
              disabled={busy || (opening !== null && opening !== row.id)}
              onClick={() => void editQuestion(row)}
            >
              {t('common.edit')}
            </Button>
            {statusActionsOf(row.status).map((action) => statusButton(row, action, name))}
            {isLinkedToExams(row) ? (
              <Tooltip title={t('questionBanks.questions.actions.deleteInUseHint')}>
                <span>
                  <Button size="small" danger aria-label={`${deleteLabel}: ${name}`} disabled>
                    {deleteLabel}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('questionBanks.questions.actions.deleteConfirm')}
                okText={deleteLabel}
                okButtonProps={{ danger: true }}
                cancelText={t('common.cancel')}
                onConfirm={() => remove(row)}
              >
                <Button size="small" danger aria-label={`${deleteLabel}: ${name}`} disabled={locked}>
                  {deleteLabel}
                </Button>
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  const failure = list.error ? describeQuestionsFailure(list.error) : null
  const { filters } = list
  const archivedOnly = filters.status === 'archived' && !filters.q && !filters.type && !filters.difficulty && !filters.tag
  const emptyText = !hasActiveQuestionFilters(filters) ? t('questionBanks.questions.empty') : archivedOnly ? t('questionBanks.questions.emptyArchived') : t('questionBanks.questions.emptyFiltered')

  return (
    <Card data-testid="questions-card">
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 8 }}>
        <Typography.Title level={4} ref={heading} tabIndex={-1} style={{ margin: 0 }}>
          {t('questionBanks.questions.heading', { name: bankName })}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={newQuestion}>
          {t('questionBanks.questions.add')}
        </Button>
      </Flex>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('questionBanks.keyNotice')}
      </Typography.Paragraph>

      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        {/* Part of the prompt, Arabic or English (`q`). */}
        <Input.Search
          allowClear
          placeholder={t('questionBanks.questions.searchPlaceholder')}
          aria-label={t('questionBanks.questions.searchPlaceholder')}
          maxLength={100}
          onSearch={(value) => list.setFilters({ q: value.trim() || undefined })}
          style={{ maxWidth: 260 }}
        />
        <Select<QuestionsListFilters['type']>
          allowClear
          placeholder={t('questionBanks.questions.filters.allTypes')}
          aria-label={t('questionBanks.questions.columns.type')}
          value={list.filters.type}
          onChange={(value) => list.setFilters({ type: value })}
          options={QUESTION_TYPES.map((value) => ({ value, label: t(`questionBanks.typesShort.${value}`) }))}
          style={{ minWidth: 170 }}
        />
        {/* No status = the drafts and the ready questions; the archived ones only when asked for. */}
        <Select<QuestionsListFilters['status']>
          allowClear
          placeholder={t('questionBanks.questions.filters.defaultStatus')}
          aria-label={t('questionBanks.questions.columns.status')}
          value={list.filters.status}
          onChange={(value) => list.setFilters({ status: value })}
          options={QUESTION_STATUSES.map((value) => ({ value, label: t(`questionBanks.statuses.${value}`) }))}
          style={{ minWidth: 180 }}
        />
        <Select<QuestionsListFilters['difficulty']>
          allowClear
          placeholder={t('questionBanks.questions.filters.allDifficulties')}
          aria-label={t('questionBanks.questions.columns.difficulty')}
          value={list.filters.difficulty}
          onChange={(value) => list.setFilters({ difficulty: value })}
          options={QUESTION_DIFFICULTIES.map((value) => ({ value, label: t(`questionBanks.difficulties.${value}`) }))}
          style={{ minWidth: 160 }}
        />
        <Input.Search
          allowClear
          placeholder={t('questionBanks.questions.filters.tag')}
          aria-label={t('questionBanks.questions.filters.tag')}
          maxLength={QUESTION_TAG_MAX_LENGTH}
          onSearch={(value) => list.setFilters({ tag: value.trim() || undefined })}
          style={{ maxWidth: 200 }}
        />
        <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('questionBanks.questions.refresh')} />
      </Flex>

      {notice ? <Alert type="error" showIcon closable={{ onClose: () => setNotice(null) }} title={notice} style={{ marginBottom: 16 }} data-testid="question-notice" /> : null}

      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={() => (isQuestionsFailure(failure, 'cursor_invalid') ? showFirstPage() : list.reload())}>
              {t('questionBanks.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Table<Question>
        rowKey="id"
        columns={columns}
        dataSource={list.items}
        loading={list.loading || busy}
        pagination={false}
        // `true`, never 'max-content': the table keeps its card's width while its columns can wrap, and scrolls inside
        // its own box only when they cannot (a phone).
        scroll={{ x: true }}
        locale={{ emptyText }}
      />

      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
        <Space>
          <Typography.Text type="secondary">{t('questionBanks.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Select<QuestionsListFilters['limit']>
            size="small"
            value={list.filters.limit}
            aria-label={t('questionBanks.pagination.questionsPageSize')}
            onChange={(value) => list.setFilters({ limit: value })}
            options={QUESTION_PAGE_SIZES.map((size) => ({ value: size, label: t('questionBanks.pagination.pageSize', { size }) }))}
          />
        </Space>
        <Space>
          <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
            {t('questionBanks.pagination.previous')}
          </Button>
          <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
            {t('questionBanks.pagination.next')}
          </Button>
        </Space>
      </Flex>

      {/* Mounted per session: the form starts from the chosen question, never from an earlier session's values (KI-049). */}
      {editing !== null ? (
        <QuestionEditor
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.updatedAt}`}
          bank={bank}
          question={editing === 'new' ? null : editing}
          onClose={() => {
            closeEditor()
            if (bankGone.current) onBankGone()
          }}
          onSaved={(saved, created) => {
            closeEditor()
            message.success(t(created ? `questionBanks.editor.created.${saved.status}` : `questionBanks.editor.saved.${saved.status}`))
            if (created) {
              showFirstPage()
              onBankChanged()
            } else {
              applyUpdate(saved)
            }
          }}
          onStale={(gone) => {
            if (gone === 'bank') {
              bankGone.current = true
              return
            }
            // The question is gone: the list and the bank's counts as the server holds them now.
            list.reload()
            onBankChanged()
          }}
        />
      ) : null}
    </Card>
  )
}
