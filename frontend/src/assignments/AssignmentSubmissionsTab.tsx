// The «submissions» tab of the assignment drawer (J-F41): the roster of
// GET /api/assignments/:id/submissions (API-108) — one row per student with an
// active or completed enrollment, plus anyone holding a submission (a withdrawn
// student stays listed), in enrollment order, each in the caller's D-R07
// projection — with the state of their latest attempt, its time in the
// assignment's zone (named once above the table when it is not this device's)
// with the server's «late» mark, its score (or the last graded score of an
// earlier attempt), and the attempts against the allowance (maxAttempts plus
// one per returned attempt — the server's numbers, never recomputed). API-108
// takes no filter, so the state filter works on the loaded rows: the whole
// roster, unpaginated — exact. A row with an attempt opens the review panel
// (SubmissionReviewPanel — API-110/API-111) on the student's latest attempt;
// the panel lists all their attempts (`history`, MOD-08-T07) and opens any of
// them. After a review the roster is read again (the review answers with that
// attempt only) and the drawer re-reads the assignment for its counts
// (onReviewed).
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Select, Skeleton, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Assignment } from '../api/assignments'
import type { Submission, SubmissionRosterItem } from '../api/submissions'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { describeAssignmentsFailure, failureMessage, isAssignmentsFailure } from './assignments.errors'
import { differsFromDevice } from './assignments.zone'
import { scoreText } from './submissions.format'
import { ROSTER_FILTERS, filterRoster, rosterScoreOf, rosterStateOf } from './submissions.roster'
import type { RosterFilter } from './submissions.roster'
import { SubmissionReviewPanel } from './SubmissionReviewPanel'
import { LateTag, SubmissionStatusTag, ZonedTime } from './SubmissionTags'
import { useSubmissionRoster } from './useSubmissionRoster'

interface AssignmentSubmissionsTabProps {
  assignment: Assignment
  /** The server's answer after a review: the drawer re-reads the assignment for its counts. */
  onReviewed: (submission: Submission) => void
  /** The assignment is gone or out of reach (404 on the roster): the drawer re-reads it. */
  onAssignmentStale: () => void
}

/** The attempt a row opens in the review panel. */
interface Reviewing {
  submissionId: string
  studentName: string
}

export function AssignmentSubmissionsTab({ assignment, onReviewed, onAssignmentStale }: AssignmentSubmissionsTabProps) {
  const { t } = useTranslation()
  const canGrade = useAuth().hasPermission('assignments.grade')
  const { roster, error, loading, reload } = useSubmissionRoster(assignment.id)
  const [filter, setFilter] = useState<RosterFilter>('all')
  const [reviewing, setReviewing] = useState<Reviewing | null>(null)
  const failure = error ? describeAssignmentsFailure(error) : null
  const zone = assignment.timeZone

  // The assignment is gone or out of reach: the drawer re-reads it (and says so).
  useEffect(() => {
    if (error && isAssignmentsFailure(describeAssignmentsFailure(error), 'assignment_not_found')) onAssignmentStale()
  }, [error, onAssignmentStale])

  const rows = roster ? filterRoster(roster.items, filter) : []
  const maxScore = roster?.assignment.maxScore ?? assignment.maxScore
  const actionLabel = canGrade ? t('assignments.roster.review') : t('assignments.roster.view')

  const columns: TableProps<SubmissionRosterItem>['columns'] = [
    {
      title: t('assignments.roster.columns.student'),
      key: 'student',
      render: (_, item) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{item.student.fullName}</Typography.Text>
          {item.student.displayName && item.student.displayName !== item.student.fullName ? <Typography.Text type="secondary">{item.student.displayName}</Typography.Text> : null}
          {/* The full projection only (users.read_contact — D-R07); null otherwise. */}
          {item.student.email ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <span dir="ltr">{item.student.email}</span>
            </Typography.Text>
          ) : null}
          {item.enrollmentStatus !== 'active' || item.student.deletedAt ? (
            <Space size={4} wrap>
              {item.enrollmentStatus === null ? <Tag>{t('assignments.roster.noEnrollment')}</Tag> : item.enrollmentStatus !== 'active' ? <StatusTag value={item.enrollmentStatus} /> : null}
              {item.student.deletedAt ? <Tag color="volcano">{t('assignments.roster.deleted')}</Tag> : null}
            </Space>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('assignments.roster.columns.state'),
      key: 'state',
      render: (_, item) => <SubmissionStatusTag status={rosterStateOf(item)} />,
    },
    {
      title: t('assignments.roster.columns.submittedAt'),
      key: 'submittedAt',
      render: (_, item) =>
        item.latest ? (
          <Space orientation="vertical" size={0}>
            <ZonedTime iso={item.latest.submittedAt} zone={zone} showZone={false} />
            <Space size={4} wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('assignments.roster.attempt', { number: item.latest.attemptNo })}
              </Typography.Text>
              {item.latest.isLate ? <LateTag /> : null}
            </Space>
          </Space>
        ) : (
          '—'
        ),
    },
    {
      title: t('assignments.roster.columns.score'),
      key: 'score',
      render: (_, item) => {
        const shown = rosterScoreOf(item)
        if (!shown) return '—'
        if (!shown.earlier) {
          return (
            <Typography.Text strong>
              <span dir="ltr">{scoreText(shown.score, maxScore)}</span>
            </Typography.Text>
          )
        }
        return (
          <Tooltip title={t('assignments.roster.earlierScoreHint')}>
            <Typography.Text type="secondary">
              {t('assignments.roster.earlierScore')}: <span dir="ltr">{scoreText(shown.score, maxScore)}</span>
            </Typography.Text>
          </Tooltip>
        )
      },
    },
    {
      title: t('assignments.roster.columns.attempts'),
      key: 'attempts',
      render: (_, item) => <span dir="ltr">{`${item.attempts} / ${item.attemptsAllowed}`}</span>,
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, item) => {
        const latest = item.latest
        if (!latest) return null
        return (
          <Button size="small" type="link" onClick={() => setReviewing({ submissionId: latest.id, studentName: item.student.fullName })} aria-label={`${actionLabel}: ${item.student.fullName}`}>
            {actionLabel}
          </Button>
        )
      },
    },
  ]

  return (
    <div data-testid="assignment-roster">
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
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {assignment.status === 'draft' ? <Alert type="info" showIcon title={t('assignments.roster.draft')} style={{ marginBottom: 12 }} /> : null}
      {!roster && !failure ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {roster ? (
        <>
          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8 }}>
            <Space wrap>
              <Select<RosterFilter>
                value={filter}
                onChange={setFilter}
                aria-label={t('assignments.roster.filter')}
                options={ROSTER_FILTERS.map((value) => ({ value, label: t(`assignments.roster.filters.${value}`) }))}
                style={{ minWidth: 180 }}
              />
              {filter !== 'all' ? <Typography.Text type="secondary">{t('assignments.roster.shown', { shown: rows.length, total: roster.items.length })}</Typography.Text> : null}
            </Space>
            <Button icon={<ReloadOutlined />} onClick={reload} disabled={loading}>
              {t('assignments.roster.reload')}
            </Button>
          </Flex>
          <Space orientation="vertical" size={0} style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('assignments.roster.filterLocal')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('assignments.roster.attemptsRule', { count: roster.maxAttempts })}
            </Typography.Text>
            {differsFromDevice(zone) ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="roster-zone">
                {t('assignments.roster.zone')} (<span dir="ltr">{zone}</span>)
              </Typography.Text>
            ) : null}
          </Space>
          <Table<SubmissionRosterItem>
            rowKey={(item) => item.student.id}
            columns={columns}
            dataSource={rows}
            loading={loading}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: roster.items.length > 0 ? t('assignments.roster.emptyFiltered') : t('assignments.roster.empty') }}
          />
        </>
      ) : null}
      {reviewing ? (
        <SubmissionReviewPanel
          // One panel per opened attempt: its form, its unsaved state and its request start afresh.
          key={reviewing.submissionId}
          submissionId={reviewing.submissionId}
          studentName={reviewing.studentName}
          onClose={() => setReviewing(null)}
          onReviewed={(submission) => {
            reload()
            onReviewed(submission)
          }}
          onStale={reload}
        />
      ) : null}
    </div>
  )
}
