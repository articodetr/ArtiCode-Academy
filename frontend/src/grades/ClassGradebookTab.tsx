// The «grades» tab of the class drawer (J-F49 — MOD-09-T08 part c): the
// gradebook the server computes on every read (API-126; D-R43/D-R44), for a
// holder of `grades.read_all` — the drawer shows the tab by that key and the
// server adds the class's visibility (D-R16: `classes.manage` or a teacher
// assigned to the class); a 404 reads as a worded «not available» state. One
// row per active or completed enrollment and a column per component (the
// class's assignments then exams that are not drafts — a component without a
// weight is informational), each cell's outcome as the server gives it (the
// counted score after the late penalty, the score before it, absent, excused,
// missing, waiting for review, sent back), the current and projected
// percentages and the final grade with its band, pass/fail, who fixed it and
// when, and its `stale` mark; above them the readiness the server counted
// (D-R45). Every number is the server's — nothing is computed here (roadmap
// §4h.5). A holder of `grades.manage` finalizes (API-127, a scheme picker over
// API-122) and withdraws (API-128), each behind its confirmation
// (FinalGradesModals.tsx); both answer with the gradebook, shown without
// another read; a refusal that means the gradebook changed re-reads it and
// says why above the table. The table scrolls sideways inside the drawer with
// the student column fixed at the start, so it stays usable on a phone. The
// gradebook is read again whenever the drawer's class changes (its status,
// its active enrollments, its server version — useGradebook's refresh key).
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, LockOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Skeleton, Space, Table, Tag, Typography, theme } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import type { FinalGrade, Gradebook, GradebookCell, GradebookComponent, GradebookStudent } from '../api/gradebook'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, localizedLabel } from '../users/users.format'
import { FinalizeGradesModal, WithdrawFinalGradesModal } from './FinalGradesModals'
import { describeGradebookFailure, gradebookFailureMessage } from './gradebook.errors'
import type { GradebookFailure } from './gradebook.errors'
import { canFinalize, cellOf, cellView, hasFinalGrades, hasStaleFinalGrades, readinessChecks } from './gradebook.view'
import type { ReadinessCheck } from './gradebook.view'
import { useGradebook } from './useGradebook'

const DASH = '—'

/** A server number as it came (`dir="ltr"`, so a decimal reads the same in Arabic). */
function Num({ value, suffix = '' }: { value: number; suffix?: string }) {
  return (
    <span dir="ltr">
      {value}
      {suffix}
    </span>
  )
}

function Percent({ value }: { value: number | null }) {
  return value === null ? <>{DASH}</> : <Num value={value} suffix="%" />
}

interface ClassGradebookTabProps {
  /** The class as the drawer holds it: its id, and the fields that make the gradebook worth reading again. */
  cls: Pick<AcademyClass, 'id' | 'status' | 'enrolledCount' | 'updatedAt'>
}

export function ClassGradebookTab({ cls }: ClassGradebookTabProps) {
  const { t } = useTranslation()
  const canManage = useAuth().hasPermission('grades.manage')
  const { gradebook, error, loading, reload, replace } = useGradebook(cls.id, `${cls.status}:${cls.enrolledCount}:${cls.updatedAt}`)
  const [dialog, setDialog] = useState<'finalize' | 'withdraw' | null>(null)
  // The refusal of the last write that re-read the gradebook (stale): said above the table until the next write or refresh.
  const [notice, setNotice] = useState<string | null>(null)
  const failure = error ? describeGradebookFailure(error) : null
  const gone = failure?.next === 'gone'

  const refresh = () => {
    setNotice(null)
    reload()
  }
  const done = (updated: Gradebook) => {
    setDialog(null)
    setNotice(null)
    replace(updated)
  }
  const refused = (refusal: GradebookFailure) => {
    setDialog(null)
    // Out of reach: the re-read shows the «not available» state; anything else is said above the re-read gradebook.
    setNotice(refusal.next === 'gone' ? null : gradebookFailureMessage(t, refusal))
    reload()
  }

  return (
    <div data-testid="class-gradebook">
      {gone ? (
        <Alert
          type="warning"
          showIcon
          title={t('gradebook.unavailable.title')}
          description={t('gradebook.unavailable.body')}
          action={
            <Button size="small" onClick={refresh}>
              {t('gradebook.retry')}
            </Button>
          }
        />
      ) : null}
      {failure && !gone ? (
        <Alert
          type="error"
          showIcon
          title={gradebookFailureMessage(t, failure)}
          action={
            <Button size="small" onClick={refresh}>
              {t('gradebook.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!gradebook && !failure ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {gradebook && !gone ? (
        <GradebookContent
          gradebook={gradebook}
          canManage={canManage}
          loading={loading}
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          onRefresh={refresh}
          onFinalize={() => setDialog('finalize')}
          onWithdraw={() => setDialog('withdraw')}
        />
      ) : null}
      {gradebook && dialog === 'finalize' ? <FinalizeGradesModal gradebook={gradebook} onDone={done} onRefused={refused} onCancel={() => setDialog(null)} /> : null}
      {gradebook && dialog === 'withdraw' ? <WithdrawFinalGradesModal gradebook={gradebook} onDone={done} onRefused={refused} onCancel={() => setDialog(null)} /> : null}
    </div>
  )
}

interface GradebookContentProps {
  gradebook: Gradebook
  canManage: boolean
  loading: boolean
  notice: string | null
  onDismissNotice: () => void
  onRefresh: () => void
  onFinalize: () => void
  onWithdraw: () => void
}

function GradebookContent({ gradebook, canManage, loading, notice, onDismissNotice, onRefresh, onFinalize, onWithdraw }: GradebookContentProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { token } = theme.useToken()
  const fixed = hasFinalGrades(gradebook)
  const ready = canFinalize(gradebook)

  const columns: TableProps<GradebookStudent>['columns'] = [
    {
      title: t('gradebook.columns.student'),
      key: 'student',
      // Fixed at the start (the right in Arabic) while the components scroll sideways — narrow enough for a phone.
      fixed: 'start',
      width: 140,
      render: (_, row) => <StudentCell row={row} />,
    },
    ...gradebook.components.map((component, index) => ({
      title: <ComponentHeader component={component} />,
      key: `${component.kind}:${component.id}`,
      // An informational component (no weight) is set apart: it never enters a percentage.
      onCell: () => (component.counted ? {} : { style: { background: token.colorFillQuaternary } }),
      render: (_: unknown, row: GradebookStudent) => <CellContent cell={cellOf(row, component, index)} />,
    })),
    { title: t('gradebook.columns.current'), key: 'current', render: (_, row) => <Percent value={row.current} /> },
    { title: t('gradebook.columns.projected'), key: 'projected', render: (_, row) => <Percent value={row.projected} /> },
    { title: t('gradebook.columns.final'), key: 'final', render: (_, row) => <FinalCell final={row.final} /> },
  ]

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">
          {gradebook.defaultScheme ? t('gradebook.defaultScheme', { name: localizedLabel(gradebook.defaultScheme.name, language) }) : t('gradebook.noDefaultScheme')}
        </Typography.Text>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            {t('gradebook.refresh')}
          </Button>
          {canManage && fixed ? (
            <Button danger icon={<DeleteOutlined />} onClick={onWithdraw}>
              {t('gradebook.withdraw.action')}
            </Button>
          ) : null}
          {canManage ? (
            <Button type="primary" icon={<LockOutlined />} disabled={!ready} onClick={onFinalize}>
              {t(fixed ? 'gradebook.finalize.actionAgain' : 'gradebook.finalize.action')}
            </Button>
          ) : null}
        </Space>
      </Flex>

      <ReadinessPanel gradebook={gradebook} ready={ready} />
      {!canManage ? <Alert type="info" showIcon title={t('gradebook.readOnly')} style={{ marginBottom: 12 }} /> : null}
      {hasStaleFinalGrades(gradebook) ? (
        <Alert type="warning" showIcon title={t(canManage ? 'gradebook.staleAlert' : 'gradebook.staleAlertReadOnly')} style={{ marginBottom: 12 }} />
      ) : null}
      {notice ? <Alert type="error" showIcon closable={{ onClose: onDismissNotice }} title={notice} style={{ marginBottom: 12 }} /> : null}
      {gradebook.components.length === 0 ? <Alert type="info" showIcon title={t('gradebook.noComponents')} style={{ marginBottom: 12 }} /> : null}

      <Table<GradebookStudent>
        rowKey={(row) => row.enrollmentId}
        columns={columns}
        dataSource={gradebook.students}
        loading={loading}
        pagination={false}
        size="small"
        bordered
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('gradebook.empty') }}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        {t('gradebook.serverNote')}
      </Typography.Paragraph>
    </>
  )
}

function ReadinessPanel({ gradebook, ready }: { gradebook: Gradebook; ready: boolean }) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const text = (check: ReadinessCheck) =>
    t(`gradebook.readiness.${check.ok ? 'ok' : 'blocked'}.${check.key}`, { count: check.count, status: t(`labels.${gradebook.class.status}`) })
  return (
    <Alert
      type={ready ? 'success' : 'warning'}
      showIcon
      title={t(ready ? 'gradebook.readiness.ready' : 'gradebook.readiness.notReady')}
      description={
        <ul data-testid="gradebook-readiness" style={{ margin: 0, paddingInlineStart: 0, listStyle: 'none' }}>
          {readinessChecks(gradebook).map((check) => (
            <li key={check.key} data-check={check.key} data-ok={check.ok}>
              {/* The wording says whether the check passes; the icon only repeats it. */}
              {check.ok ? <CheckCircleOutlined aria-hidden style={{ color: token.colorSuccess }} /> : <CloseCircleOutlined aria-hidden style={{ color: token.colorError }} />} {text(check)}
            </li>
          ))}
        </ul>
      }
      style={{ marginBottom: 12 }}
    />
  )
}

function StudentCell({ row }: { row: GradebookStudent }) {
  const { t } = useTranslation()
  const { student } = row
  return (
    <Space orientation="vertical" size={2}>
      <Typography.Text strong>{student.fullName}</Typography.Text>
      {student.displayName && student.displayName !== student.fullName ? <Typography.Text type="secondary">{student.displayName}</Typography.Text> : null}
      {row.enrollmentStatus === 'completed' || student.deletedAt ? (
        <Space size={4} wrap>
          {row.enrollmentStatus === 'completed' ? <Tag color="green">{t('gradebook.student.completed')}</Tag> : null}
          {student.deletedAt ? <Tag color="volcano">{t('gradebook.student.deleted')}</Tag> : null}
        </Space>
      ) : null}
    </Space>
  )
}

function ComponentHeader({ component }: { component: GradebookComponent }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const facts = [
    component.counted ? t('gradebook.component.weight', { weight: component.weight }) : t('gradebook.component.informational'),
    t('gradebook.component.maxScore', { max: component.maxScore }),
    ...(component.latePenaltyPercent !== null ? [t('gradebook.component.latePenalty', { percent: component.latePenaltyPercent })] : []),
  ]
  return (
    <Space orientation="vertical" size={2} style={{ minWidth: 120 }} data-testid={`gradebook-component-${component.id}`}>
      <Typography.Text strong>{localizedLabel(component.title, language)}</Typography.Text>
      <Space size={4} wrap>
        <Tag>{t(`gradebook.kind.${component.kind}`)}</Tag>
        <StatusTag value={component.status} />
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
        {facts.join(' · ')}
      </Typography.Text>
    </Space>
  )
}

function CellContent({ cell }: { cell: GradebookCell | null }) {
  const { t } = useTranslation()
  if (!cell) return <>{DASH}</>
  const view = cellView(cell)
  return (
    <Space orientation="vertical" size={2}>
      {view.value !== null ? (
        <Typography.Text strong>
          <Num value={view.value} />
        </Typography.Text>
      ) : null}
      {view.before !== null ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('gradebook.cell.beforePenalty', { score: view.before })}
        </Typography.Text>
      ) : null}
      {view.label || view.late ? (
        <Space size={4} wrap>
          {view.label ? <Tag color={view.color}>{t(`gradebook.cell.status.${view.label}`)}</Tag> : null}
          {view.late ? <Tag color="orange">{t('gradebook.cell.late')}</Tag> : null}
        </Space>
      ) : null}
    </Space>
  )
}

function FinalCell({ final }: { final: FinalGrade | null }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  if (!final) return <Typography.Text type="secondary">{t('gradebook.final.none')}</Typography.Text>
  return (
    <Space orientation="vertical" size={2}>
      <Space size={4} wrap>
        <Typography.Text strong>
          <Num value={final.percent} suffix="%" />
        </Typography.Text>
        <Tag color={final.isPass ? 'green' : 'red'} icon={final.isPass ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
          {localizedLabel(final.label, language)}
          {final.letter ? (
            <>
              {' '}
              <bdi dir="ltr">({final.letter})</bdi>
            </>
          ) : null}
        </Tag>
        <Typography.Text type={final.isPass ? 'success' : 'danger'}>{t(final.isPass ? 'gradebook.final.pass' : 'gradebook.final.fail')}</Typography.Text>
      </Space>
      {final.stale ? (
        <Tag color="warning" icon={<WarningOutlined />} title={t('gradebook.final.staleHint')}>
          {t('gradebook.final.stale')}
        </Tag>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {final.finalizedBy ? t('gradebook.final.by', { name: final.finalizedBy.fullName }) : t('gradebook.final.byUnknown')}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {formatDateTime(final.finalizedAt, language)}
      </Typography.Text>
    </Space>
  )
}
