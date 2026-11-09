// The review panel of one submission (J-F41): a drawer above the assignment
// drawer that reads GET /api/submissions/:id (API-110) — the attempt with the
// student's attempt counts, its answer (text and link), the server's «late»
// mark and the last review — and, for a holder of `assignments.grade`, the
// grading form that writes the whole new review state with POST
// /api/submissions/:id/review (API-111): `grade` with a score 0..maxScore (two
// decimals) and an optional feedback — a blank one clears the previous — or
// `return` with a mandatory feedback, which clears the score and grants one
// more attempt (D-R39). Any attempt of any status is reviewable, also of a
// closed assignment. The smallest body goes out (planReview() of
// submissions.status.ts — the mirror of backend/src/assignments/
// submissions.policy.ts), nothing when the review equals the stored one; the
// panel then shows the server's answer in a new form session (KI-049). Every
// time is shown in the assignment's `timeZone` (D-R41), named when it is not
// this device's. While the form holds something unsaved, Escape and a mask
// click do nothing and the panel's own close (its × and «cancel») asks first;
// the guard of the assignment drawer itself and of the browser's back and
// reload comes when J-F27 meets J-F38.
import { LinkOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Flex, Form, Input, InputNumber, Radio, Skeleton, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Assignment } from '../api/assignments'
import { FEEDBACK_MAX_LENGTH, reviewSubmission } from '../api/submissions'
import type { ReviewAction, Submission } from '../api/submissions'
import { useAuth } from '../auth/auth-context'
import { describeAssignmentsFailure, failureMessage, isAssignmentsFailure } from './assignments.errors'
import { isHttpsLink, scoreText } from './submissions.format'
import { availableReviewActions, isReviewDraftDirty, isScoreValid, normalizeFeedback, planReview, returnCaveats, reviewDraftOf, reviewEffects } from './submissions.status'
import type { ReviewDraft } from './submissions.status'
import { LateTag, SubmissionStatusTag, ZonedTime } from './SubmissionTags'
import { useSubmission } from './useSubmission'

interface SubmissionReviewPanelProps {
  submissionId: string
  /** The drawer's assignment (API-103): its display zone and its late policy — a submission carries neither. */
  assignment: Pick<Assignment, 'timeZone' | 'allowLate'>
  /** The name the roster shows, for the title until the submission is read. */
  studentName: string
  onClose: () => void
  /** The server's answer after a review that was sent. */
  onReviewed: (submission: Submission) => void
  /** The submission is gone or out of reach (404): the roster is read again. */
  onStale: () => void
}

export function SubmissionReviewPanel({ submissionId, assignment, studentName, onClose, onReviewed, onStale }: SubmissionReviewPanelProps) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const canGrade = useAuth().hasPermission('assignments.grade')
  const { submission, error, version, reload, replace } = useSubmission(submissionId)
  const [dirty, setDirty] = useState(false)
  const failure = error ? describeAssignmentsFailure(error) : null

  // A submission that is gone (or out of reach) is no longer on the roster as it was: the roster re-reads.
  useEffect(() => {
    if (error && isAssignmentsFailure(describeAssignmentsFailure(error), 'submission_not_found')) onStale()
  }, [error, onStale])

  /** The panel's × and «cancel» (Escape and the mask too while nothing is unsaved): asks first while the form holds unsaved work. */
  const requestClose = () => {
    if (!dirty) {
      onClose()
      return
    }
    modal.confirm({
      title: t('assignments.review.discard.title'),
      content: t('assignments.review.discard.content'),
      okText: t('assignments.review.discard.ok'),
      okButtonProps: { danger: true },
      cancelText: t('assignments.review.discard.cancel'),
      onOk: onClose,
    })
  }

  return (
    <Drawer
      open
      onClose={requestClose}
      // Unsaved work turns off the Escape key and the mask click; this panel sits on top of the
      // assignment drawer, so only it hears Escape (the rc portal stack) and its mask covers the drawer.
      keyboard={!dirty}
      mask={{ closable: !dirty }}
      title={t('assignments.review.titleOf', { name: submission?.student.fullName ?? studentName })}
      // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
      size="min(640px, 100vw)"
      destroyOnHidden
    >
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('assignments.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!submission && !failure ? <Skeleton active paragraph={{ rows: 6 }} data-testid="submission-loading" /> : null}
      {submission ? (
        <>
          <SubmissionDetails submission={submission} zone={assignment.timeZone} />
          {submission.attemptNo > 1 ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('assignments.review.earlierAttempts', { number: submission.attemptNo })}
            </Typography.Paragraph>
          ) : null}
          {canGrade ? (
            <ReviewForm
              // One form session per server version of the submission (KI-049): after a review it starts from the answer.
              key={`${submission.id}:${version}`}
              submission={submission}
              allowLate={assignment.allowLate}
              onDirtyChange={setDirty}
              onReviewed={(answer) => {
                setDirty(false)
                replace(answer)
                onReviewed(answer)
              }}
              onGone={() => {
                setDirty(false)
                onStale()
                onClose()
              }}
              onCancel={requestClose}
            />
          ) : (
            <Alert type="info" showIcon title={t('assignments.review.readOnly')} />
          )}
        </>
      ) : null}
    </Drawer>
  )
}

function SubmissionDetails({ submission, zone }: { submission: Submission; zone: string }) {
  const { t } = useTranslation()
  const dash = '—'
  const { student, gradedBy } = submission
  const reviewer = gradedBy ? gradedBy.displayName?.trim() || gradedBy.fullName : t('assignments.review.reviewerGone')

  return (
    <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }} data-testid="submission-details">
      <Descriptions.Item label={t('assignments.review.fields.student')}>
        {student.fullName}
        {student.displayName && student.displayName !== student.fullName ? <Typography.Text type="secondary"> ({student.displayName})</Typography.Text> : null}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.attempt')}>
        {t('assignments.review.attemptOf', { number: submission.attemptNo, attempts: submission.attempts, allowed: submission.attemptsAllowed })}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.status')}>
        <SubmissionStatusTag status={submission.status} />
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.submittedAt')}>
        <Flex gap={4} wrap align="center">
          <ZonedTime iso={submission.submittedAt} zone={zone} />
          {submission.isLate ? <LateTag /> : null}
        </Flex>
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.textAnswer')}>
        {submission.textAnswer ? (
          // A plain element: antd Typography's RTL class would override `dir` (an English answer keeps its own direction).
          <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-testid="submission-text">
            {submission.textAnswer}
          </div>
        ) : (
          <Typography.Text type="secondary">{t('assignments.review.noText')}</Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.linkUrl')}>
        {isHttpsLink(submission.linkUrl) ? (
          <Typography.Link href={submission.linkUrl} target="_blank" rel="noopener noreferrer">
            <LinkOutlined /> <span dir="ltr" style={{ overflowWrap: 'anywhere' }}>{submission.linkUrl}</span>
          </Typography.Link>
        ) : (
          <Typography.Text type="secondary">{t('assignments.review.noLink')}</Typography.Text>
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.score')}>
        {submission.score !== null ? <span dir="ltr">{scoreText(submission.score, submission.assignment.maxScore)}</span> : dash}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.feedback')}>
        {submission.feedback ? (
          <div dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {submission.feedback}
          </div>
        ) : (
          dash
        )}
      </Descriptions.Item>
      <Descriptions.Item label={t('assignments.review.fields.reviewedBy')}>
        {submission.gradedAt ? (
          <Flex gap={4} wrap align="center">
            <span>{reviewer}</span>
            <span>—</span>
            <ZonedTime iso={submission.gradedAt} zone={zone} />
          </Flex>
        ) : (
          <Typography.Text type="secondary">{t('assignments.review.notReviewed')}</Typography.Text>
        )}
      </Descriptions.Item>
    </Descriptions>
  )
}

interface ReviewFormProps {
  submission: Submission
  allowLate: boolean
  onDirtyChange: (dirty: boolean) => void
  /** The server's answer after a review that was sent. */
  onReviewed: (submission: Submission) => void
  /** 404: the submission is gone or out of reach. */
  onGone: () => void
  onCancel: () => void
}

/**
 * The grading form of one session: it starts from the stored review
 * (reviewDraftOf()), so an untouched form sends nothing, and it reports
 * whether it holds unsaved work. Every rule words its own message; the server
 * stays the boundary — `score_out_of_range` and `feedback_required` come back
 * onto their fields, a 404 closes the panel and the roster re-reads.
 */
function ReviewForm({ submission, allowLate, onDirtyChange, onReviewed, onGone, onCancel }: ReviewFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [initial] = useState(() => reviewDraftOf(submission))
  // Followed from onValuesChange (not Form.useWatch, which reports a render later): the fields and hints switch at once.
  const [action, setAction] = useState<ReviewAction>(initial.action)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const max = submission.assignment.maxScore
  const effects = reviewEffects(submission.status, action)
  const caveats = action === 'return' ? returnCaveats({ ...submission.assignment, allowLate }) : []
  const notes = [
    effects.grantsAttempt ? t('assignments.review.effects.grantsAttempt') : null,
    effects.clearsScore ? t('assignments.review.effects.clearsScore') : null,
    effects.withdrawsAttempt ? t('assignments.review.effects.withdrawsAttempt') : null,
    ...caveats.map((caveat) => t(`assignments.review.effects.${caveat}`)),
  ].filter((note): note is string => note !== null)

  const fieldMessage = (field: 'score' | 'feedback') =>
    field === 'score' ? t('assignments.review.validation.score', { max }) : t('assignments.review.validation.feedbackRequired')

  const save = async (values: ReviewDraft) => {
    const plan = planReview(submission, { ...values, action })
    if (plan.kind === 'unchanged') {
      message.info(t('assignments.review.nothingChanged'))
      return
    }
    if (plan.kind === 'invalid') {
      form.setFields([{ name: plan.field, errors: [fieldMessage(plan.field)] }])
      return
    }
    setSaving(true)
    setError(null)
    try {
      const answer = await reviewSubmission(submission.id, plan.body)
      message.success(t(`assignments.review.done.${plan.body.action}`))
      // The panel replaces the submission with the answer, which remounts this form (a new session).
      onReviewed(answer)
    } catch (caught) {
      setSaving(false)
      const failure = describeAssignmentsFailure(caught)
      const text = failureMessage(t, failure)
      if (isAssignmentsFailure(failure, 'submission_not_found')) {
        message.error(text)
        onGone()
        return
      }
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
    }
  }

  return (
    <Form
      form={form}
      name="submission-review"
      layout="vertical"
      requiredMark={false}
      initialValues={initial}
      onValuesChange={(changed: Partial<ReviewDraft>, values: Partial<ReviewDraft>) => {
        if (changed.action) setAction(changed.action)
        onDirtyChange(isReviewDraftDirty(initial, values))
      }}
      onFinish={(values) => void save(values as ReviewDraft)}
      disabled={saving}
      data-testid="review-form"
    >
      <Form.Item name="action" label={t('assignments.review.form.action')}>
        <Radio.Group
          // Its own name: a generated one is shared in tests (rc-util's useId).
          name={`review-action-${submission.id}`}
          optionType="button"
          buttonStyle="solid"
          options={availableReviewActions(true).map((value) => ({ value, label: t(`assignments.review.form.actions.${value}`) }))}
        />
      </Form.Item>
      {action === 'grade' ? (
        <Form.Item
          name="score"
          label={t('assignments.review.form.score', { max })}
          extra={t('assignments.review.form.scoreHint', { max })}
          rules={[
            { required: true, message: t('assignments.review.validation.scoreRequired') },
            {
              validator: (_: unknown, value: unknown) =>
                value === null || value === undefined || isScoreValid(value, max) ? Promise.resolve() : Promise.reject(new Error(t('assignments.review.validation.score', { max }))),
            },
          ]}
        >
          <InputNumber style={{ width: 180 }} />
        </Form.Item>
      ) : null}
      <Form.Item
        name="feedback"
        label={t('assignments.review.form.feedback')}
        extra={action === 'return' ? t('assignments.review.form.feedbackReturnHint') : t('assignments.review.form.feedbackGradeHint')}
        dependencies={['action']}
        rules={[
          {
            validator: (_: unknown, value: string | undefined) =>
              action === 'return' && normalizeFeedback(value) === null ? Promise.reject(new Error(t('assignments.review.validation.feedbackRequired'))) : Promise.resolve(),
          },
          { max: FEEDBACK_MAX_LENGTH, message: t('assignments.review.validation.maxLength', { max: FEEDBACK_MAX_LENGTH }) },
        ]}
      >
        <Input.TextArea rows={4} maxLength={FEEDBACK_MAX_LENGTH} showCount />
      </Form.Item>
      {notes.length > 0 ? (
        <Alert
          type={caveats.length > 0 ? 'warning' : 'info'}
          showIcon
          title={
            <>
              {notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </>
          }
          style={{ marginBottom: 16 }}
          data-testid="review-effects"
        />
      ) : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t(`assignments.review.form.submit.${action}`)}
        </Button>
      </Flex>
    </Form>
  )
}
