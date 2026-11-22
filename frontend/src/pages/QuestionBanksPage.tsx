// The question banks page (MOD-09 phase 2 — roadmap §4r, OEX-T07): the banks
// the server returns for a holder of `questions.manage` (GET
// /api/question-banks, API-260 — it applies the visibility itself, D-R162: with
// `classes.manage` every bank, else the caller's own and those of a course they
// teach a class of; the page never filters by owner), with a search by name, a
// course filter («بلا دورة» = `courseId=none`) and keyset pages; a modal to
// create or edit a bank (smallest PATCH); a delete behind a confirmation; and,
// below, the questions of the bank chosen (src/questions/QuestionsPanel.tsx)
// with their editor. The route and the navigation entry keep everybody else out
// (`questions.manage`); the server stays the boundary.
//
// Everything here carries answer keys: the page is the teachers' side, never a
// learner's view, and offers no preview or share link. Every number is the
// server's: after a question is written the bank is read again (API-262) rather
// than counted here.
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Empty, Flex, Input, Popconfirm, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NO_COURSE_FILTER, deleteQuestionBank, getQuestionBank } from '../api/questionBanks'
import type { QuestionBank } from '../api/questionBanks'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { BankCoursePicker } from '../questions/BankCoursePicker'
import { BankFormModal } from '../questions/BankFormModal'
import { QuestionsPanel } from '../questions/QuestionsPanel'
import { describeQuestionsFailure, failureMessage, isGoneFailure, isQuestionsFailure } from '../questions/questions.errors'
import { BANK_PAGE_SIZES, hasActiveBankFilters, useQuestionBanksList } from '../questions/useQuestionBanksList'
import type { QuestionBanksFilters } from '../questions/useQuestionBanksList'
import { useReturnFocus } from '../questions/useReturnFocus'
import { formatDateTime, localizedLabel } from '../users/users.format'

export function QuestionBanksPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  // The server lists every bank for a holder of classes.manage; anyone else their own and their courses' (D-R162).
  const seesEveryBank = hasPermission('classes.manage')
  // GET /api/courses needs courses.read: the course filter lists courses only with it.
  const canPickCourse = hasPermission('courses.read')
  const list = useQuestionBanksList()
  const [selected, setSelected] = useState<QuestionBank | null>(null)
  // Moves with every request to show a bank's questions, so the bank already on screen answers it too (its heading takes the focus).
  const [revealKey, setRevealKey] = useState(0)
  const [editing, setEditing] = useState<QuestionBank | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const focus = useReturnFocus()

  const openBankForm = (target: QuestionBank | 'new') => {
    focus.remember()
    setEditing(target)
  }

  const showQuestions = (bank: QuestionBank) => {
    setSelected(bank)
    setRevealKey((key) => key + 1)
  }

  const nameOf = (bank: QuestionBank) => localizedLabel(bank.name, language)
  // The row on screen is the freshest copy of the chosen bank (an edit or a re-read replaced it there).
  const shown = selected ? (list.items.find((bank) => bank.id === selected.id) ?? selected) : null

  /** Back to the first page with a fresh read: the newest bank comes first. */
  const showFirstPage = () => {
    list.setFilters({})
    list.reload()
  }

  /** The bank is gone or out of reach (404): nothing of it stays on screen, and the list is read again. */
  const bankGone = (bankId: string) => {
    setSelected((current) => (current?.id === bankId ? null : current))
    setNotice(t('questionBanks.errors.question_bank_not_found'))
    list.reload()
  }

  /** The bank as the server holds it now — its counts after a question was written. */
  const refreshBank = (bankId: string) => {
    getQuestionBank(bankId)
      .then((fresh) => {
        list.replaceItem(fresh)
        setSelected((current) => (current?.id === fresh.id ? fresh : current))
      })
      .catch((caught: unknown) => {
        // Anything but «gone» leaves the last known counts: the refresh button reads them again.
        if (isGoneFailure(describeQuestionsFailure(caught))) bankGone(bankId)
      })
  }

  const remove = async (bank: QuestionBank) => {
    setBusy(true)
    setNotice(null)
    try {
      await deleteQuestionBank(bank.id)
      message.success(t('questionBanks.banks.deleted', { name: nameOf(bank) }))
      setSelected((current) => (current?.id === bank.id ? null : current))
      // The last row of the page: read the page again rather than show an empty table.
      if (list.items.length <= 1) list.reload()
      else list.removeItem(bank.id)
    } catch (caught) {
      const failure = describeQuestionsFailure(caught)
      if (isQuestionsFailure(failure, 'question_bank_not_found')) bankGone(bank.id)
      else setNotice(failureMessage(t, failure))
    } finally {
      setBusy(false)
    }
  }

  const columns: TableProps<QuestionBank>['columns'] = [
    {
      title: t('questionBanks.banks.columns.bank'),
      key: 'bank',
      render: (_, row) => (
        <div style={{ minWidth: 180, maxWidth: 420 }}>
          <Typography.Text strong>{nameOf(row)}</Typography.Text>
          {row.description ? (
            <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ fontSize: 12, marginBottom: 0 }}>
              {localizedLabel(row.description, language)}
            </Typography.Paragraph>
          ) : null}
        </div>
      ),
    },
    {
      title: t('questionBanks.banks.columns.course'),
      key: 'course',
      render: (_, row) =>
        row.course ? (
          <span>
            <Typography.Text strong>
              <bdi dir="ltr">{row.course.code}</bdi>
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">{localizedLabel(row.course.name, language)}</Typography.Text>
          </span>
        ) : (
          <Typography.Text type="secondary">{t('questionBanks.banks.noCourse')}</Typography.Text>
        ),
    },
    {
      title: t('questionBanks.banks.columns.questions'),
      key: 'questions',
      // The server's two numbers, as they are.
      render: (_, row) => (
        <span data-testid="bank-counts">
          <Typography.Text>{t('questionBanks.banks.questionCount', { count: row.questionCount })}</Typography.Text>
          <br />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('questionBanks.banks.readyCount', { ready: row.readyCount })}
          </Typography.Text>
        </span>
      ),
    },
    {
      title: t('questionBanks.banks.columns.author'),
      key: 'author',
      render: (_, row) => (row.createdBy ? row.createdBy.fullName : <Typography.Text type="secondary">{t('questionBanks.banks.deletedAuthor')}</Typography.Text>),
    },
    { title: t('questionBanks.banks.columns.updatedAt'), key: 'updatedAt', render: (_, row) => formatDateTime(row.updatedAt, language) },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const name = nameOf(row)
        const isShown = shown?.id === row.id
        const deleteLabel = t('questionBanks.banks.actions.delete')
        return (
          // The row itself is clickable (it shows the bank's questions): a click on its buttons — or inside the
          // confirmation they open, which bubbles through the React tree — must not reach it.
          <Space size={4} wrap onClick={(event) => event.stopPropagation()} data-testid="bank-actions">
            <Button size="small" type={isShown ? 'primary' : 'default'} aria-pressed={isShown} aria-label={`${t('questionBanks.banks.actions.questions')}: ${name}`} onClick={() => showQuestions(row)}>
              {t('questionBanks.banks.actions.questions')}
            </Button>
            <Button size="small" aria-label={`${t('common.edit')}: ${name}`} disabled={busy} onClick={() => openBankForm(row)}>
              {t('common.edit')}
            </Button>
            <Popconfirm
              title={t('questionBanks.banks.actions.deleteConfirm', { name })}
              okText={deleteLabel}
              okButtonProps={{ danger: true }}
              cancelText={t('common.cancel')}
              onConfirm={() => remove(row)}
            >
              <Button size="small" danger aria-label={`${deleteLabel}: ${name}`} disabled={busy}>
                {deleteLabel}
              </Button>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const failure = list.error ? describeQuestionsFailure(list.error) : null
  const emptyText = hasActiveBankFilters(list.filters) ? t('questionBanks.banks.emptyFiltered') : seesEveryBank ? t('questionBanks.banks.empty') : t('questionBanks.banks.emptyVisible')

  return (
    <>
      <PageHeader
        title={t('questionBanks.title')}
        subtitle={t('questionBanks.subtitle')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openBankForm('new')}>
            {t('questionBanks.banks.add')}
          </Button>
        }
      />

      {!seesEveryBank ? <Alert type="info" showIcon title={t('questionBanks.banks.visibilityHint')} style={{ marginBottom: 16 }} /> : null}

      <Card data-testid="question-banks-card" style={{ marginBottom: 16 }}>
        <Flex gap={12} wrap align="center" style={{ marginBottom: 8 }}>
          {/* Part of the name, Arabic or English (`q`). */}
          <Input.Search
            allowClear
            placeholder={t('questionBanks.banks.searchPlaceholder')}
            aria-label={t('questionBanks.banks.searchPlaceholder')}
            maxLength={100}
            onSearch={(value) => list.setFilters({ q: value.trim() || undefined })}
            style={{ maxWidth: 280 }}
          />
          {canPickCourse ? (
            <BankCoursePicker
              withNoCourse
              allowClear
              placeholder={t('questionBanks.banks.allCourses')}
              aria-label={t('questionBanks.banks.columns.course')}
              value={list.filters.courseId}
              onChange={(value) => list.setFilters({ courseId: value })}
              style={{ minWidth: 260 }}
            />
          ) : (
            // Without courses.read no course can be listed: the filter still tells the banks filed under none.
            <Select<QuestionBanksFilters['courseId']>
              allowClear
              placeholder={t('questionBanks.banks.allCourses')}
              aria-label={t('questionBanks.banks.columns.course')}
              value={list.filters.courseId}
              onChange={(value) => list.setFilters({ courseId: value })}
              options={[{ value: NO_COURSE_FILTER, label: t('questionBanks.banks.noCourse') }]}
              style={{ minWidth: 200 }}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('questionBanks.banks.refresh')} />
        </Flex>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('questionBanks.banks.countsHint')}
        </Typography.Paragraph>

        {notice ? <Alert type="error" showIcon closable={{ onClose: () => setNotice(null) }} title={notice} style={{ marginBottom: 16 }} data-testid="bank-notice" /> : null}

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

        <Table<QuestionBank>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading || busy}
          pagination={false}
          // `true`, never 'max-content': the table keeps its card's width while its columns can wrap, and scrolls
          // inside its own box only when they cannot (a phone).
          scroll={{ x: true }}
          locale={{ emptyText }}
          rowClassName={(row) => (row.id === shown?.id ? 'ant-table-row-selected' : '')}
          onRow={(row) => ({ onClick: () => showQuestions(row), style: { cursor: 'pointer' } })}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('questionBanks.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<QuestionBanksFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('questionBanks.pagination.banksPageSize')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={BANK_PAGE_SIZES.map((size) => ({ value: size, label: t('questionBanks.pagination.pageSize', { size }) }))}
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
      </Card>

      {shown ? (
        // Mounted per bank: its list starts from the first page and its heading takes the focus.
        <QuestionsPanel key={shown.id} bank={shown} revealKey={revealKey} onBankChanged={() => refreshBank(shown.id)} onBankGone={() => bankGone(shown.id)} />
      ) : list.items.length > 0 ? (
        // Something to choose from: say where the questions will show. (Without a bank on screen there is nothing to pick.)
        <Card data-testid="questions-card">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('questionBanks.questions.pick')} />
        </Card>
      ) : null}

      {/* Mounted per session: the form starts from the chosen bank, never from an earlier session's values (KI-049). */}
      {editing !== null ? (
        <BankFormModal
          key={editing === 'new' ? 'new' : `${editing.id}:${editing.updatedAt}`}
          bank={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null)
            focus.giveBack()
          }}
          onSaved={(saved, created) => {
            setEditing(null)
            if (created) {
              message.success(t('questionBanks.banks.created', { name: nameOf(saved) }))
              showFirstPage()
              // The next step is writing its questions: they come on screen, and their heading takes the focus.
              showQuestions(saved)
            } else {
              message.success(t('questionBanks.banks.saved'))
              list.replaceItem(saved)
              setSelected((current) => (current?.id === saved.id ? saved : current))
              focus.giveBack()
            }
          }}
          onStale={() => {
            if (editing !== 'new') bankGone(editing.id)
          }}
        />
      ) : null}
    </>
  )
}
