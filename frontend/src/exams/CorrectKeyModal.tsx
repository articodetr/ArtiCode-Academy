// «تصحيح المفتاح» of the «الأسئلة» tab (MOD-09 phase 2 — API-272, D-R161), for a
// holder of `exams.grade`: the key of ONE frozen question of an online exam
// that was made available. The grader chooses the answer that is really
// correct — one of the question's own options, or صحيح / خطأ for a true/false
// question; the dialog starts on the key recorded now — and gives a REQUIRED
// reason (1–500 characters after trimming). It says what the server then does
// in one audited step: every finished attempt is graded again, students'
// results may change, the reason is recorded; the bank question is not touched.
// The body names the field of the question's type only (buildCorrectKeyInput()).
// The server's answer — the corrected question and the regrade counts, or
// `changed: false` for the key the question already had — goes to the tab,
// which shows it and re-reads. A refusal that means the exam or the question
// changed elsewhere (`exam_not_frozen`, `exam_not_online`, `class_closed`,
// `question_not_found`, a key that no longer fits) ends the dialog and makes
// the tab re-read; `grades_certified` (the class holds issued certificates) and
// a missing permission stay in the dialog with their words.
// While the dialog holds a typed reason or another answer than the key, Escape
// and a mask click do nothing and × / «إلغاء» ask first (examOnline.key.discard.*);
// it reports that to the tab (`onDirtyChange`), so the drawer's own guard keeps
// it on a browser back or a reload — one navigation guard per page (KI-055).
import { Alert, Form, Input, Modal, Radio, Tag } from 'antd'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CORRECTION_REASON_MAX_LENGTH, correctExamQuestionKey } from '../api/examQuestions'
import type { ExamQuestionItem, KeyCorrectionResult } from '../api/examQuestions'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeKeyCorrectionFailure } from './examQuestions.errors'
import { answerChoicesOf, buildCorrectKeyInput, isCorrectionReasonValid, keyChoiceOf } from './examQuestions.view'
import { failureMessage } from './exams.errors'

interface CorrectKeyModalProps {
  examId: string
  /** The frozen question whose key is corrected (an item of API-270). */
  item: ExamQuestionItem
  /** Its position in the exam, 1 first. */
  number: number
  /** The server's answer: the question after the correction and the regrade counts (`changed: false` = nothing was written). */
  onDone: (result: KeyCorrectionResult) => void
  /** The exam or the question changed elsewhere: the tab says why, closes the dialog and re-reads. */
  onStale: (message: string) => void
  onCancel: () => void
  /** Whether the dialog holds work a close would drop: a typed reason, or another answer than the key. */
  onDirtyChange: (dirty: boolean) => void
}

interface KeyFormValues {
  /** An option's id, or TRUE_CHOICE / FALSE_CHOICE. */
  choice?: string
  reason?: string
}

export function CorrectKeyModal({ examId, item, number, onDone, onStale, onCancel, onDirtyChange }: CorrectKeyModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [form] = Form.useForm<KeyFormValues>()
  const radioName = useId()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const choices = answerChoicesOf(item.question)
  const currentKey = keyChoiceOf(item.question)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  // The dialog left (sent, cancelled, stale): it holds nothing any more.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // × and «إلغاء» ask first while the dialog holds something; the browser's own navigation is the drawer's to guard.
  const { requestClose } = useUnsavedChangesGuard(dirty, onCancel, 'examOnline.key.discard')

  const submit = async (values: KeyFormValues) => {
    const input = buildCorrectKeyInput(item.question.type, values.choice, values.reason)
    if (!input) return
    setSaving(true)
    setError(null)
    try {
      const result = await correctExamQuestionKey(examId, item.id, input)
      // Sent: nothing is left to lose, even before the tab closes the dialog.
      setDirty(false)
      onDone(result)
    } catch (caught) {
      const failure = describeKeyCorrectionFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.next === 'stale' || failure.next === 'gone') {
        setDirty(false)
        onStale(text)
        return
      }
      setError(text)
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t('examOnline.key.title', { number })}
      okText={t('examOnline.key.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      // Typed work turns off the Escape key and the mask click.
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      width={640}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} data-testid="correct-key-error" /> : null}
      {/* A plain element: antd Typography's RTL class would override dir="auto". */}
      <div dir="auto" style={{ fontWeight: 600, whiteSpace: 'pre-wrap', marginBottom: 16 }} data-testid="correct-key-prompt">
        {localizedLabel(item.question.prompt, language)}
      </div>
      <Form<KeyFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={saving}
        initialValues={{ choice: currentKey, reason: '' }}
        // Synchronous, so an Escape pressed right after a keystroke already finds the dialog holding it.
        onValuesChange={(_, values) => setDirty((values.reason ?? '').trim() !== '' || values.choice !== currentKey)}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="choice" label={t('examOnline.key.answer')} rules={[{ required: true, message: t('examOnline.key.answerRequired') }]}>
          <Radio.Group
            name={`exam-key-${radioName}`}
            orientation="vertical"
            aria-label={t('examOnline.key.answer')}
            options={choices.map((choice) => ({
              value: choice.value,
              label: (
                <span>
                  <span dir="auto">{choice.text ? localizedLabel(choice.text, language) : t(`examOnline.answers.${choice.answer}`)}</span>
                  {choice.isKey ? <Tag style={{ marginInlineStart: 8 }}>{t('examOnline.key.current')}</Tag> : null}
                </span>
              ),
            }))}
          />
        </Form.Item>
        <Form.Item
          name="reason"
          label={t('examOnline.key.reason')}
          extra={t('examOnline.key.reasonHint')}
          rules={[
            {
              validator: (_, value: string | undefined) => {
                if (isCorrectionReasonValid(value)) return Promise.resolve()
                const tooLong = (value ?? '').trim().length > CORRECTION_REASON_MAX_LENGTH
                return Promise.reject(new Error(tooLong ? t('examOnline.key.reasonMax', { max: CORRECTION_REASON_MAX_LENGTH }) : t('examOnline.key.reasonRequired')))
              },
            },
          ]}
        >
          <Input.TextArea rows={3} maxLength={CORRECTION_REASON_MAX_LENGTH} showCount dir="auto" />
        </Form.Item>
      </Form>
      <Alert type="warning" showIcon title={t('examOnline.key.effectTitle')} description={t('examOnline.key.effect')} />
    </Modal>
  )
}
