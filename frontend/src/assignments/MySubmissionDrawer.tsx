// The learner's view of one attempt (J-F42): GET /api/submissions/:id (API-110
// — no key at the guard; the server answers its student and their guardian,
// 404 anyone else) for the latest attempt of a row of «my assignments» (the
// `latest.id` of API-112 — the only attempt a learner can reach: no route lists
// the earlier ones). It shows the attempt number out of those allowed, the
// submission time with the server's late mark, the status, the score out of
// the maximum once graded, the teacher's feedback, the reviewer by name and
// the review time — every instant in the assignment's zone (D-R41) — and the
// answer itself (the text, and the link opened in a new tab). Nothing the DTO
// hides is asked for, and no id is shown. The attempt read is handed to the
// page, which keeps the row in step with it (applySubmission()).
import { Alert, Button, Card, Descriptions, Drawer, Skeleton, Space, Tag, Typography } from 'antd'
import type { DescriptionsProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getMySubmission } from '../api/myAssignments'
import type { MyAssignmentItem, MySubmission } from '../api/myAssignments'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf } from '../users/users.format'
import { assignmentTitle, formatZonedDateTime } from './assignments.format'
import { differsFromDevice } from './assignments.zone'
import { describeMyAssignmentsFailure, failureMessage, isMyAssignmentsFailure } from './myAssignments.errors'
import { MY_SUBMISSION_COLORS, scoreText } from './myAssignments.view'

interface MySubmissionDrawerProps {
  /** The row whose latest attempt is shown; null (or a row without an attempt) = closed. */
  item: MyAssignmentItem | null
  onClose: () => void
  /** The attempt as the server returned it. */
  onLoaded: (submission: MySubmission) => void
}

interface DrawerState {
  /** The submission the state belongs to: another row's state never shows. */
  id: string | null
  submission: MySubmission | null
  error: string | null
}

/** The server takes `https://` links only; anything else is shown as text, never as a link. */
function isHttpsLink(value: string): boolean {
  return /^https:\/\//i.test(value)
}

export function MySubmissionDrawer({ item, onClose, onLoaded }: MySubmissionDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const submissionId = item?.latest?.id ?? null
  const [state, setState] = useState<DrawerState>({ id: null, submission: null, error: null })
  const [reloadTick, setReloadTick] = useState(0)
  // The page's callback changes with its rows; the request must not restart for that.
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  useEffect(() => {
    if (!submissionId) return
    const controller = new AbortController()
    getMySubmission(submissionId, controller.signal)
      .then((submission) => {
        if (controller.signal.aborted) return
        setState({ id: submissionId, submission, error: null })
        onLoadedRef.current(submission)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const failure = describeMyAssignmentsFailure(error)
        // An attempt that is gone (or out of reach) no longer shows its last known details.
        const keep = !isMyAssignmentsFailure(failure, 'submission_not_found')
        setState((current) => ({ id: submissionId, submission: keep && current.id === submissionId ? current.submission : null, error: failureMessage(t, failure) }))
      })
    return () => controller.abort()
  }, [submissionId, reloadTick, t])

  const current = state.id === submissionId ? state : { submission: null, error: null }
  const title = item
    ? item.relation === 'child'
      ? t('myAssignments.drawer.titleChild', { name: displayNameOf(item.student), title: assignmentTitle(item, language) })
      : t('myAssignments.drawer.titleMine', { title: assignmentTitle(item, language) })
    : ''

  return (
    // antd 6: `size` takes a CSS length; the panel never exceeds a phone viewport.
    <Drawer open={submissionId !== null} onClose={onClose} title={title} size="min(640px, 100vw)" destroyOnHidden>
      {current.error ? (
        <Alert
          type="error"
          showIcon
          title={current.error}
          action={
            <Button size="small" onClick={() => setReloadTick((tick) => tick + 1)}>
              {t('myAssignments.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!current.submission && !current.error ? <Skeleton active paragraph={{ rows: 6 }} data-testid="my-submission-loading" /> : null}
      {current.submission && item ? <SubmissionDetails submission={current.submission} item={item} /> : null}
    </Drawer>
  )
}

function SubmissionDetails({ submission, item }: { submission: MySubmission; item: MyAssignmentItem }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const zone = item.timeZone
  const at = (iso: string) => formatZonedDateTime(iso, zone, language)
  const reviewer = submission.gradedBy
    ? displayNameOf(submission.gradedBy)
    : submission.gradedAt
      ? t('myAssignments.drawer.reviewerGone')
      : t('myAssignments.drawer.notReviewed')

  const items: DescriptionsProps['items'] = [
    ...(item.relation === 'child' ? [{ key: 'student', label: t('myAssignments.drawer.student'), children: displayNameOf(submission.student) }] : []),
    {
      key: 'attempt',
      label: t('myAssignments.drawer.attempt'),
      children: t('myAssignments.drawer.attemptOf', { number: submission.attemptNo, attempts: submission.attempts, allowed: submission.attemptsAllowed }),
    },
    {
      key: 'submittedAt',
      label: t('myAssignments.drawer.submittedAt'),
      children: (
        <Space size={4} wrap>
          <span>{at(submission.submittedAt)}</span>
          {submission.isLate ? <Tag color="volcano">{t('myAssignments.submission.late')}</Tag> : null}
        </Space>
      ),
    },
    {
      key: 'status',
      label: t('myAssignments.drawer.status'),
      children: <Tag color={MY_SUBMISSION_COLORS[submission.status]}>{t(`myAssignments.submission.${submission.status}`)}</Tag>,
    },
    {
      key: 'score',
      label: t('myAssignments.drawer.score'),
      children:
        submission.status === 'graded' && submission.score !== null ? (
          <Typography.Text strong>
            <span dir="ltr">{scoreText(submission.score, submission.assignment.maxScore)}</span>
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">{t('myAssignments.notGraded')}</Typography.Text>
        ),
    },
    {
      key: 'feedback',
      label: t('myAssignments.drawer.feedback'),
      children: submission.feedback ? (
        <div dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
          {submission.feedback}
        </div>
      ) : (
        <Typography.Text type="secondary">{t('myAssignments.drawer.noFeedback')}</Typography.Text>
      ),
    },
    { key: 'reviewedBy', label: t('myAssignments.drawer.reviewedBy'), children: reviewer },
    { key: 'reviewedAt', label: t('myAssignments.drawer.reviewedAt'), children: submission.gradedAt ? at(submission.gradedAt) : '—' },
  ]

  return (
    <>
      {submission.attemptNo > 1 ? <Alert type="info" showIcon title={t('myAssignments.drawer.latestOnly')} style={{ marginBottom: 16 }} /> : null}
      <Descriptions size="small" column={1} bordered items={items} />
      {differsFromDevice(zone) ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          {t('myAssignments.drawer.zone')} (<span dir="ltr">{zone}</span>)
        </Typography.Paragraph>
      ) : null}
      <Card size="small" title={t('myAssignments.drawer.answer')} style={{ marginTop: 16 }}>
        {submission.textAnswer ? (
          // A plain element: antd Typography's RTL class would override dir="auto".
          <div dir="auto" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }} data-testid="my-submission-text">
            {submission.textAnswer}
          </div>
        ) : (
          <Typography.Paragraph type="secondary">{t('myAssignments.drawer.noText')}</Typography.Paragraph>
        )}
        <div>
          <Typography.Text type="secondary">{t('myAssignments.drawer.link')}: </Typography.Text>
          {submission.linkUrl ? (
            isHttpsLink(submission.linkUrl) ? (
              <a href={submission.linkUrl} target="_blank" rel="noopener noreferrer" dir="ltr" style={{ overflowWrap: 'anywhere' }}>
                {submission.linkUrl}
              </a>
            ) : (
              <span dir="ltr">{submission.linkUrl}</span>
            )
          ) : (
            <Typography.Text type="secondary">{t('myAssignments.drawer.noLink')}</Typography.Text>
          )}
        </div>
      </Card>
    </>
  )
}
