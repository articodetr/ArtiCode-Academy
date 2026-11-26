// The options of a single-choice question inside the editor's <Form> (MOD-09
// phase 2 — OEX-T07): an ordered Form.List of 2..10 rows, each with its Arabic
// text, its optional English text and ONE radio across the rows marking the
// key; add, remove, move up and move down. The radios are native radios of one
// name inside a labelled group, so the arrow keys walk them. A row's «correct»
// mark lives in the row itself (`isCorrect`), so it travels with its row when
// the row moves and goes with it when the row is removed; marking a row writes
// the whole list through `form.setFieldValue`, which fires no `onValuesChange`
// — the editor is told through `onChanged`. Focus follows the content: a new
// row takes it, the «add» button takes it after a removal, and a moved row
// keeps it on a button that still works. The messages of a refused save (the
// server's rules about the options, mirrored in questions.rules.ts) show under
// the rows; the per-row rule (a text a row cannot be sent without) is its
// Arabic field's.
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Col, Flex, Form, Input, Radio, Row, Space, Typography } from 'antd'
import type { FormInstance } from 'antd'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { OPTION_TEXT_MAX_LENGTH, QUESTION_OPTIONS_MAX, QUESTION_OPTIONS_MIN } from '../api/questionBanks'
import type { QuestionProblem } from '../api/questionBanks'
import { emptyOption, markCorrectOption, optionRowIssue } from './questions.form'
import type { OptionFormValues } from './questions.form'

const OPTIONS = 'options'
const TITLE_ID = 'question-editor-options-title'
/** One name for the radios of every row: the browser then treats them as one group. */
const CORRECT_RADIO_NAME = 'question-editor-correct-option'

interface QuestionOptionsFieldProps {
  form: FormInstance
  /** What the last refused save found in the options (the server's vocabulary), in catalogue order. */
  problems: readonly QuestionProblem[]
  /** A row was marked as the key: the editor recomputes what it holds (setFieldValue fires no onValuesChange). */
  onChanged: () => void
}

export function QuestionOptionsField({ form, problems, onChanged }: QuestionOptionsFieldProps) {
  const { t } = useTranslation()
  const container = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  // True from a click on «add» until the new row has taken the focus.
  const focusNewRow = useRef(false)
  /** Asked by each row when it mounts: true once, for the row «add» has just made. */
  const claimFocus = useCallback(() => {
    const wanted = focusNewRow.current
    focusNewRow.current = false
    return wanted
  }, [])

  const rowsNow = () => (form.getFieldValue(OPTIONS) as OptionFormValues[] | undefined) ?? []

  /** The rows' own messages follow what changed around them: a mark moved away, a row removed or moved. */
  const revalidateFlagged = () => {
    const flagged = form
      .getFieldsError()
      .filter((field) => field.errors.length > 0 && field.name[0] === OPTIONS)
      .map((field) => field.name)
    if (flagged.length > 0) void form.validateFields(flagged).catch(() => undefined)
  }

  const markCorrect = (index: number) => {
    form.setFieldValue(OPTIONS, markCorrectOption(rowsNow(), index))
    revalidateFlagged()
    onChanged()
  }

  /** After a move the row keeps the focus: on the same arrow while it still works, else on the other one. */
  const focusMoved = (key: number, direction: 'up' | 'down') => {
    setTimeout(() => {
      const row = container.current?.querySelector(`[data-option-key="${key}"]`)
      const same = row?.querySelector<HTMLButtonElement>(`button[data-move="${direction}"]:not(:disabled)`)
      const target = same ?? row?.querySelector<HTMLButtonElement>('button[data-move]:not(:disabled)')
      target?.focus()
      revalidateFlagged()
    }, 0)
  }

  return (
    <div ref={container} role="group" aria-labelledby={TITLE_ID} data-testid="question-options" style={{ marginBottom: 24 }}>
      <Typography.Title level={5} id={TITLE_ID} style={{ marginTop: 0 }}>
        {t('questionBanks.editor.fields.options')}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('questionBanks.editor.hints.options')}</Typography.Paragraph>
      <Form.List name={OPTIONS}>
        {(fields, { add, remove, move }) => (
          <Flex vertical gap={8}>
            {fields.map((field, index) => {
              const number = index + 1
              const isCorrect = form.getFieldValue([OPTIONS, field.name, 'isCorrect']) === true
              return (
                <Card
                  key={field.key}
                  size="small"
                  role="group"
                  aria-label={t('questionBanks.editor.option', { number })}
                  data-testid="question-option"
                  data-option-key={field.key}
                  // The title wraps on a phone instead of being cut: it holds the radio.
                  styles={{ title: { whiteSpace: 'normal' }, body: { paddingBottom: 0 } }}
                  title={
                    <Space size={12} wrap>
                      <span>{t('questionBanks.editor.option', { number })}</span>
                      <Radio name={CORRECT_RADIO_NAME} checked={isCorrect} onChange={() => markCorrect(field.name)} aria-label={t('questionBanks.editor.correctOptionOf', { number })}>
                        {t('questionBanks.editor.correctOption')}
                      </Radio>
                    </Space>
                  }
                  extra={
                    <Space size={4}>
                      <Button
                        size="small"
                        icon={<ArrowUpOutlined />}
                        data-move="up"
                        aria-label={t('questionBanks.editor.moveOptionUp', { number })}
                        disabled={index === 0}
                        onClick={() => {
                          move(index, index - 1)
                          focusMoved(field.key, 'up')
                        }}
                      />
                      <Button
                        size="small"
                        icon={<ArrowDownOutlined />}
                        data-move="down"
                        aria-label={t('questionBanks.editor.moveOptionDown', { number })}
                        disabled={index === fields.length - 1}
                        onClick={() => {
                          move(index, index + 1)
                          focusMoved(field.key, 'down')
                        }}
                      />
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('questionBanks.editor.removeOption', { number })}
                        disabled={fields.length <= QUESTION_OPTIONS_MIN}
                        onClick={() => {
                          remove(field.name)
                          // The row is gone with its buttons: the focus goes to «add», which is never disabled after a removal.
                          setTimeout(() => {
                            addButton.current?.focus()
                            revalidateFlagged()
                          }, 0)
                        }}
                      />
                    </Space>
                  }
                >
                  <OptionRowFields form={form} index={field.name} claimFocus={claimFocus} />
                </Card>
              )
            })}
            {/* Always in the page, so a message that appears is announced. */}
            <div role="alert" data-testid="question-options-problems">
              {problems.map((problem) => (
                <Typography.Text key={problem} type="danger" style={{ display: 'block' }}>
                  {t(`questionBanks.problems.${problem}`)}
                </Typography.Text>
              ))}
            </div>
            <Button
              ref={addButton}
              type="dashed"
              icon={<PlusOutlined />}
              disabled={fields.length >= QUESTION_OPTIONS_MAX}
              onClick={() => {
                focusNewRow.current = true
                add(emptyOption())
              }}
            >
              {t('questionBanks.editor.addOption')}
            </Button>
          </Flex>
        )}
      </Form.List>
    </div>
  )
}

interface OptionRowFieldsProps {
  form: FormInstance
  /** The row's place in the list (its Form.List name). */
  index: number
  /** True once, for the row «add» has just made: it takes the focus. */
  claimFocus: () => boolean
}

/** The two texts of one row. */
function OptionRowFields({ form, index, claimFocus }: OptionRowFieldsProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (claimFocus()) form.focusField([OPTIONS, index, 'textAr'])
  }, [claimFocus, form, index])

  const maxLength = { max: OPTION_TEXT_MAX_LENGTH, message: t('questionBanks.editor.validation.maxLength', { max: OPTION_TEXT_MAX_LENGTH }) }

  return (
    <Row gutter={12}>
      <Col xs={24}>
        <Form.Item
          name={[index, 'textAr']}
          label={t('questionBanks.editor.fields.optionAr')}
          // The row's English text decides whether an empty Arabic one is refused.
          dependencies={[[OPTIONS, index, 'textEn']]}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const row = form.getFieldValue([OPTIONS, index]) as OptionFormValues | undefined
                const issue = optionRowIssue({ ...row, textAr: value })
                if (issue) throw new Error(t(`questionBanks.editor.validation.${issue}`))
              },
            },
            maxLength,
          ]}
        >
          <Input maxLength={OPTION_TEXT_MAX_LENGTH} />
        </Form.Item>
      </Col>
      <Col span={0}>
        <Form.Item name={[index, 'textEn']} label={t('questionBanks.editor.fields.optionEn')} rules={[maxLength]}>
          <Input dir="ltr" maxLength={OPTION_TEXT_MAX_LENGTH} />
        </Form.Item>
      </Col>
    </Row>
  )
}
