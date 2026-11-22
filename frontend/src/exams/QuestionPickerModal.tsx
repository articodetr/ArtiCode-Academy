// «إضافة أسئلة» of the «الأسئلة» tab (MOD-09 phase 2): picks `ready` questions
// of a question bank for the question set of an online draft. First a bank —
// a server-backed select on API-260 (the banks the caller sees, searched by
// name) — then that bank's questions on API-265 with `status=ready` (a draft or
// archived question cannot be linked: `question_not_ready`), searched by their
// text and read page by page («تحميل المزيد» appends the next keyset page). A
// question the set already holds is listed as added and cannot be ticked; the
// ticks survive a search, another page and another bank, and stop at the room
// the exam has left (EXAM_QUESTIONS_MAX). Confirming hands the ticked questions
// — in the order they were ticked, each with its bank — to the editor, which
// appends them with their own default points; nothing is sent to the server
// here (the editor saves the whole set in one PUT). The body is mounted per
// open session. While something is ticked, Escape and a mask click do nothing;
// × and «إلغاء» leave at once.
import { Alert, Button, Checkbox, Empty, Flex, Form, Input, Modal, Skeleton, Space, Tag, Typography, theme } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EXAM_QUESTIONS_MAX } from '../api/examQuestions'
import { listQuestionBanks, listQuestions } from '../api/questionBanks'
import type { Question, QuestionBank } from '../api/questionBanks'
import { RemoteSelect } from '../components/RemoteSelect'
import type { RemoteOption } from '../components/RemoteSelect'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeExamsFailure, failureMessage } from './exams.errors'

const BANK_OPTIONS_LIMIT = 20
/** Questions per page of the list. */
export const PICKER_PAGE_SIZE = 20

/** A ticked question with the bank it was picked from. */
export interface PickedQuestion {
  question: Question
  bank: QuestionBank
}

interface QuestionPickerModalProps {
  /** The questions the set already holds: listed as added, not selectable. */
  linkedIds: ReadonlySet<string>
  /** How many more questions the set takes. */
  room: number
  /** The ticked questions, in the order they were ticked. */
  onAdd: (picked: PickedQuestion[]) => void
  onClose: () => void
}

interface ListState {
  /** The request the state answers. */
  key: string
  items: Question[]
  nextCursor: string | null
  error: unknown
}

const EMPTY_LIST: ListState = { key: '', items: [], nextCursor: null, error: null }

export function QuestionPickerModal({ linkedIds, room, onAdd, onClose }: QuestionPickerModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const [bank, setBank] = useState<QuestionBank | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const [list, setList] = useState<ListState>(EMPTY_LIST)
  const [selected, setSelected] = useState<ReadonlyMap<string, PickedQuestion>>(() => new Map())

  const bankId = bank?.id
  const requestKey = JSON.stringify([bankId, query, cursor, tick])
  const loading = bankId !== undefined && list.key !== requestKey

  useEffect(() => {
    if (!bankId) return
    const controller = new AbortController()
    listQuestions({ bankId, status: 'ready', q: query || undefined, limit: PICKER_PAGE_SIZE, cursor }, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setList((current) => ({
          key: requestKey,
          // «تحميل المزيد» appends; a new bank or search starts over.
          items: cursor ? [...current.items, ...page.items.filter((item) => !current.items.some((row) => row.id === item.id))] : page.items,
          nextCursor: page.nextCursor,
          error: null,
        }))
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // A failed «تحميل المزيد» keeps the rows; its cursor stays so that the page can be asked again.
        setList((current) => ({ ...current, key: requestKey, items: cursor ? current.items : [], error }))
      },
    )
    return () => controller.abort()
  }, [bankId, query, cursor, requestKey])

  const fetchBanks = useCallback((q: string, signal: AbortSignal) => listQuestionBanks({ q, limit: BANK_OPTIONS_LIMIT }, signal).then((page) => page.items), [])
  const bankOption = (item: QuestionBank): RemoteOption => ({
    value: item.id,
    label: t('examOnline.picker.bankOption', { name: localizedLabel(item.name, language), ready: item.readyCount }),
  })

  const chooseBank = (next: QuestionBank | undefined) => {
    setBank(next)
    setQuery('')
    setCursor(undefined)
  }
  const search = (text: string) => {
    setQuery(text.trim())
    setCursor(undefined)
  }

  const full = selected.size >= room
  const toggle = (question: Question, checked: boolean) => {
    if (!bank) return
    setSelected((current) => {
      const next = new Map(current)
      if (!checked) next.delete(question.id)
      else if (next.size < room) next.set(question.id, { question, bank })
      return next
    })
  }

  // The rows of another bank or search are not shown while their replacement loads.
  const items = loading && !cursor ? [] : list.items
  const failure = !loading && list.error ? describeExamsFailure(list.error) : null
  const holdsTicks = selected.size > 0

  return (
    <Modal
      open
      title={t('examOnline.picker.title')}
      okText={t('examOnline.picker.submit', { value: selected.size })}
      okButtonProps={{ disabled: !holdsTicks }}
      cancelText={t('common.cancel')}
      onOk={() => onAdd([...selected.values()])}
      onCancel={onClose}
      // Ticked questions are not dropped by a stray Escape or mask click; × and «إلغاء» leave on purpose.
      keyboard={!holdsTicks}
      mask={{ closable: !holdsTicks }}
      width={760}
      destroyOnHidden
    >
      <Form layout="vertical" component={false}>
        <Form.Item label={t('examOnline.picker.bank')} htmlFor="exam-question-picker-bank" style={{ marginBottom: 12 }}>
          <RemoteSelect<QuestionBank>
            id="exam-question-picker-bank"
            fetchOptions={fetchBanks}
            toOption={bankOption}
            value={bankId}
            onChange={(_, item) => chooseBank(item)}
            emptyText={t('examOnline.picker.noBanks')}
            placeholder={t('examOnline.picker.bankPlaceholder')}
            allowClear
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>

      {!bank ? (
        <Typography.Paragraph type="secondary">{t('examOnline.picker.chooseBank')}</Typography.Paragraph>
      ) : (
        <>
          <Input.Search
            // A new bank starts with an empty search box.
            key={bank.id}
            allowClear
            placeholder={t('examOnline.picker.search')}
            aria-label={t('examOnline.picker.search')}
            maxLength={100}
            onSearch={search}
            style={{ marginBottom: 8 }}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
            {t('examOnline.picker.onlyReady')}
          </Typography.Paragraph>

          {failure ? (
            <Alert
              type="error"
              showIcon
              title={t('examOnline.picker.loadError')}
              description={failureMessage(t, failure)}
              action={
                <Button size="small" onClick={() => setTick((value) => value + 1)}>
                  {t('examOnline.picker.retry')}
                </Button>
              }
              style={{ marginBottom: 8 }}
            />
          ) : null}

          {loading && items.length === 0 ? <Skeleton active paragraph={{ rows: 4 }} data-testid="question-picker-loading" /> : null}
          {!loading && !failure && items.length === 0 ? <Empty description={query ? t('examOnline.picker.emptySearch') : t('examOnline.picker.empty')} /> : null}

          {items.length > 0 ? (
            <div role="list" style={{ maxHeight: 360, overflowY: 'auto', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius }}>
              {items.map((question) => {
                const linked = linkedIds.has(question.id)
                const checked = selected.has(question.id)
                return (
                  <div key={question.id} role="listitem" data-testid="question-picker-row" style={{ padding: '8px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                    <Flex justify="space-between" align="flex-start" gap={8} wrap>
                      <Checkbox checked={checked} disabled={linked || (!checked && full)} onChange={(event) => toggle(question, event.target.checked)} style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <span dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {localizedLabel(question.prompt, language)}
                        </span>
                      </Checkbox>
                      <Space size={4} wrap>
                        {linked ? <Tag color="green">{t('examOnline.picker.added')}</Tag> : null}
                        <Tag>{t(`examOnline.types.${question.type}`)}</Tag>
                        <Tag>{t('examOnline.questions.points', { points: question.points })}</Tag>
                      </Space>
                    </Flex>
                  </div>
                )
              })}
            </div>
          ) : null}

          {list.nextCursor && items.length > 0 ? (
            <Flex justify="center" style={{ marginTop: 8 }}>
              <Button onClick={() => setCursor(list.nextCursor ?? undefined)} loading={loading}>
                {t('examOnline.picker.loadMore')}
              </Button>
            </Flex>
          ) : null}
        </>
      )}

      <Flex justify="space-between" wrap gap={8} style={{ marginTop: 12 }}>
        <Typography.Text strong data-testid="question-picker-selected">
          {t('examOnline.picker.selected', { value: selected.size })}
        </Typography.Text>
        <Typography.Text type={full ? 'warning' : 'secondary'}>
          {full ? t('examOnline.picker.full', { max: EXAM_QUESTIONS_MAX }) : t('examOnline.picker.room', { value: room - selected.size, max: EXAM_QUESTIONS_MAX })}
        </Typography.Text>
      </Flex>
    </Modal>
  )
}
