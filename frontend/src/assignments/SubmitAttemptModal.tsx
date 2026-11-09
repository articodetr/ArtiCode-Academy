// The attempt modal of «my assignments» (J-F42): POST
// /api/assignments/:id/submissions (API-109) for a `self` row of a holder of
// `assignments.submit` that takes an attempt now (submitAvailability() of
// myAssignments.view.ts). The body is mounted per session (KI-049), so every
// attempt starts from an empty form; it hands its submit to the modal's OK
// button while mounted (the CreateAssignmentModal pattern). It shows what a
// learner needs to answer — learners never read API-103 (D-R40), so it all
// comes from the API-112 row: the class, the due date in the assignment's zone
// (D-R41), the maximum score, the attempt number out of those allowed, the
// late mark under allowLate, the feedback of a returned attempt and the
// instructions. The text and the link are checked locally
// (myAssignments.submit.ts — the SubmitAssignmentDto rules) and the attempt is
// sent only after a confirmation that it cannot be edited afterwards (D-R38).
// A refusal naming the answer is shown on its field; a terminal one (closed,
// past due, attempts used up, not enrolled, no permission, gone) ends the
// session's sending — the form stays, so the text can be copied — and the page
// re-reads its list.
import { Alert, App, Descriptions, Form, Input, Modal, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SUBMIT_LINK_MAX_LENGTH, SUBMIT_TEXT_MAX_LENGTH, submitMyAttempt } from '../api/myAssignments'
import type { MyAssignmentItem, MySubmission, MySubmitInput } from '../api/myAssignments'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { assignmentTitle, formatZonedDateTime } from './assignments.format'
import { differsFromDevice } from './assignments.zone'
import { describeMyAssignmentsFailure, failureMessage } from './myAssignments.errors'
import { buildSubmitInput, hasAnswer, isTextAnswerWithinLimit, linkProblemOf } from './myAssignments.submit'
import type { SubmitFormValues } from './myAssignments.submit'
import { attemptsLeftAfterNext, isPastDue, myAssignmentKey } from './myAssignments.view'

interface SubmitAttemptModalProps {
  /** The row of this session; null = closed. */
  item: MyAssignmentItem | null
  onClose: () => void
  /** The attempt as the server stored it (201). */
  onSubmitted: (submission: MySubmission) => void
  /** A refusal no retry of this attempt can change: the page re-reads its list. */
  onStale: () => void
}

export function SubmitAttemptModal({ item, onClose, onSubmitted, onStale }: SubmitAttemptModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const [saving, setSaving] = useState(false)
  // The form lives in the body, mounted per open session; the modal only submits it (as CreateAssignmentModal).
  const [submit, setSubmit] = useState<(() => void) | null>(null)
  const onReady = useCallback((fn: (() => void) | null) => setSubmit(() => fn), [])

  return (
    <Modal
      open={item !== null}
      title={item ? t('myAssignments.submit.title', { title: assignmentTitle(item, language) }) : null}
      okText={t('myAssignments.submit.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: !submit }}
      onOk={() => submit?.()}
      onCancel={() => {
        if (!saving) onClose()
      }}
      width={720}
      destroyOnHidden
    >
      {item ? <SubmitAttemptBody key={myAssignmentKey(item)} item={item} onSaving={setSaving} onReady={onReady} onSubmitted={onSubmitted} onStale={onStale} /> : null}
    </Modal>
  )
}

interface SubmitAttemptBodyProps {
  item: MyAssignmentItem
  onSaving: (saving: boolean) => void
  /** This session's submit on mount and while it may still send, null otherwise. */
  onReady: (submit: (() => void) | null) => void
  onSubmitted: (submission: MySubmission) => void
  onStale: () => void
}

function SubmitAttemptBody({ item, onSaving, onReady, onSubmitted, onStale }: SubmitAttemptBodyProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { modal } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const [saving, setSaving] = useState(false)
  // Read once per session: the warning does not flip while the student types (the server marks the attempt it receives).
  const [late] = useState(() => isPastDue(item))
  // The server numbers the attempt after the highest one (submitAttempt: lastAttemptNo + 1).
  const number = (item.latest?.attemptNo ?? 0) + 1
  const left = attemptsLeftAfterNext(item)
  const returned = item.latest?.status === 'returned' ? item.latest : null
  const penalty = item.latePenaltyPercent !== null && item.latePenaltyPercent > 0 ? item.latePenaltyPercent : null

  useEffect(() => {
    if (stopped) return
    onReady(() => form.submit())
    return () => onReady(null)
  }, [form, onReady, stopped])

  const send = async (input: MySubmitInput) => {
    setSaving(true)
    onSaving(true)
    setError(null)
    try {
      onSubmitted(await submitMyAttempt(item.id, input))
    } catch (caught) {
      const failure = describeMyAssignmentsFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
      if (failure.terminal) {
        setStopped(true)
        onStale()
      }
    } finally {
      setSaving(false)
      onSaving(false)
    }
  }

  // D-R38: an attempt is a new row the student can neither edit nor delete — say so, with what is left, before sending.
  const confirmAndSend = (values: SubmitFormValues) => {
    const input = buildSubmitInput(values)
    if (!input) return
    modal.confirm({
      title: t('myAssignments.submit.confirm.title', { number }),
      content: left > 0 ? t('myAssignments.submit.confirm.remaining', { count: left }) : t('myAssignments.submit.confirm.last'),
      okText: t('myAssignments.submit.confirm.ok'),
      cancelText: t('myAssignments.submit.confirm.cancel'),
      onOk: () => {
        void send(input)
      },
    })
  }

  return (
    <>
      {error ? <Alert type="error" showIcon title={error} description={stopped ? t('myAssignments.submit.stopped') : undefined} style={{ marginBottom: 16 }} /> : null}

      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'class',
            label: t('myAssignments.columns.class'),
            children: (
              <span>
                <span dir="ltr">{item.class.code}</span> — {localizedLabel(item.class.name, language)}
              </span>
            ),
          },
          {
            key: 'due',
            label: t('myAssignments.columns.due'),
            children: item.dueAt ? (
              <span>
                {formatZonedDateTime(item.dueAt, item.timeZone, language)}
                {differsFromDevice(item.timeZone) ? (
                  <>
                    {' '}
                    <span dir="ltr" style={{ fontSize: 12, opacity: 0.65 }}>
                      ({item.timeZone})
                    </span>
                  </>
                ) : null}
              </span>
            ) : (
              t('myAssignments.noDue')
            ),
          },
          { key: 'maxScore', label: t('myAssignments.details.maxScore'), children: <span dir="ltr">{item.maxScore}</span> },
          { key: 'attempt', label: t('myAssignments.columns.attempts'), children: t('myAssignments.submit.attempt', { number, allowed: item.attemptsAllowed }) },
        ]}
      />

      {late ? (
        <Alert type="warning" showIcon title={penalty !== null ? t('myAssignments.submit.latePenalty', { percent: penalty }) : t('myAssignments.submit.late')} style={{ marginBottom: 16 }} />
      ) : null}

      {returned?.feedback ? (
        <Alert
          type="info"
          showIcon
          title={t('myAssignments.submit.returnedFeedback', { number: returned.attemptNo })}
          description={<div style={{ whiteSpace: 'pre-wrap' }}>{returned.feedback}</div>}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Typography.Title level={5}>{t('myAssignments.details.instructions')}</Typography.Title>
      {item.instructions ? (
        // A plain element: antd Typography's RTL class would override dir="auto".
        <div dir="auto" style={{ whiteSpace: 'pre-wrap', marginBottom: 16 }}>
          {localizedLabel(item.instructions, language)}
        </div>
      ) : (
        <Typography.Paragraph type="secondary">{t('myAssignments.details.noInstructions')}</Typography.Paragraph>
      )}

      <Alert type="info" showIcon title={t('myAssignments.submit.immutable')} style={{ marginBottom: 16 }} />

      <Form form={form} layout="vertical" requiredMark={false} disabled={saving} onFinish={(values) => confirmAndSend(values as SubmitFormValues)}>
        <Form.Item
          name="textAnswer"
          label={t('myAssignments.submit.textAnswer')}
          extra={t('myAssignments.submit.textHint')}
          dependencies={['linkUrl']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                hasAnswer({ textAnswer: value as string | undefined, linkUrl: getFieldValue('linkUrl') as string | undefined })
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('myAssignments.validation.answerRequired'))),
            }),
            {
              validator: (_, value) =>
                isTextAnswerWithinLimit(value as string | undefined) ? Promise.resolve() : Promise.reject(new Error(t('myAssignments.validation.textMax', { max: SUBMIT_TEXT_MAX_LENGTH }))),
            },
          ]}
        >
          <Input.TextArea autoSize={{ minRows: 6, maxRows: 16 }} maxLength={SUBMIT_TEXT_MAX_LENGTH} showCount dir="auto" />
        </Form.Item>
        <Form.Item
          name="linkUrl"
          label={t('myAssignments.submit.linkUrl')}
          extra={t('myAssignments.submit.linkHint')}
          rules={[
            {
              validator: (_, value) => {
                const problem = linkProblemOf(value as string | undefined)
                if (problem === null) return Promise.resolve()
                return Promise.reject(new Error(problem === 'max' ? t('myAssignments.validation.linkMax', { max: SUBMIT_LINK_MAX_LENGTH }) : t('myAssignments.validation.link')))
              },
            },
          ]}
        >
          <Input dir="ltr" maxLength={SUBMIT_LINK_MAX_LENGTH} placeholder="https://" inputMode="url" autoComplete="off" />
        </Form.Item>
      </Form>
    </>
  )
}
