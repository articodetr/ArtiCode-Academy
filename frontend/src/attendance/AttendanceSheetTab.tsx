// The «attendance» tab of the lesson drawer (J-F10): the sheet of API-099 —
// one row per student with their enrollment status and record — and, for a
// holder of `attendance.record` while the server says `recordable`, an editor
// that saves the changed rows in ONE PUT (API-100). Each row is sent as the
// whole new state of that record; nothing is sent when no row changed; the
// screen shows the server's answer only (no optimistic rows), then the lesson's
// counts follow it in the drawer and the list. A student whose enrollment is
// not active or completed (withdrawn after the lesson, cancelled…) stays
// listed read-only — the server refuses them with `not_enrolled`.
import { ReloadOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Input, InputNumber, Popconfirm, Radio, Skeleton, Space, Table, Tag, Typography, theme } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ATTENDANCE_BATCH_MAX, ATTENDANCE_NOTE_MAX_LENGTH, ATTENDANCE_STATUSES, MINUTES_LATE_MAX, recordAttendance } from '../api/attendance'
import type { AttendanceItem, AttendanceSheet, AttendanceStatus } from '../api/attendance'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { changedItems, currentDraft, draftProblem, isBatchTooLarge, isRecordableItem, markAllPresent, planAttendanceSave, unrecordedItems, withStatus } from './attendance.changes'
import type { AttendanceDraft } from './attendance.changes'
import { describeAttendanceFailure, failureMessage } from './attendance.errors'
import { ATTENDANCE_STATUS_COLORS } from './attendance.format'
import { useAttendanceSheet } from './useAttendanceSheet'

interface AttendanceSheetTabProps {
  lesson: Pick<Lesson, 'id'>
  /** The sheet the server answered after a save: its counts update the lesson in the drawer and in the list. */
  onSaved: (sheet: AttendanceSheet) => void
  /** The lesson changed elsewhere (cancelled, not started, gone): the drawer re-reads it. */
  onLessonStale: () => void
}

export function AttendanceSheetTab({ lesson, onSaved, onLessonStale }: AttendanceSheetTabProps) {
  const { t } = useTranslation()
  const canRecord = useAuth().hasPermission('attendance.record')
  const { sheet, error, loading, version, reload, replace } = useAttendanceSheet(lesson.id)
  const failure = error ? describeAttendanceFailure(error) : null

  return (
    <div data-testid="attendance-sheet">
      {failure ? (
        <Alert
          type="error"
          showIcon
          title={failureMessage(t, failure)}
          action={
            <Button size="small" onClick={reload}>
              {t('attendance.reload')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {!sheet && !failure ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {sheet ? (
        <AttendanceEditor
          // One edit session per server version of the sheet (KI-049): a save or a reload starts from the server's state.
          key={`${sheet.lessonId}:${version}`}
          sheet={sheet}
          canRecord={canRecord}
          loading={loading}
          onSaved={(saved) => {
            replace(saved)
            onSaved(saved)
          }}
          onStale={() => {
            reload()
            onLessonStale()
          }}
          onGone={onLessonStale}
          onReload={reload}
        />
      ) : null}
    </div>
  )
}

interface AttendanceEditorProps {
  sheet: AttendanceSheet
  canRecord: boolean
  loading: boolean
  onSaved: (sheet: AttendanceSheet) => void
  onStale: () => void
  onGone: () => void
  onReload: () => void
}

function AttendanceEditor({ sheet, canRecord, loading, onSaved, onStale, onGone, onReload }: AttendanceEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [drafts, setDrafts] = useState<ReadonlyMap<string, AttendanceDraft>>(() => new Map())
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editable = canRecord && sheet.recordable
  const changed = changedItems(sheet.items, drafts)
  const changedIds = new Set(changed.map((item) => item.student.id))
  const problems = new Map(changed.flatMap((item) => {
    const problem = draftProblem(currentDraft(item, drafts))
    return problem ? [[item.student.id, problem] as const] : []
  }))
  const unrecorded = editable ? unrecordedItems(sheet.items, drafts) : []
  const nameOf = (studentId: string) => sheet.items.find((item) => item.student.id === studentId)?.student.fullName ?? studentId

  const update = (studentId: string, draft: AttendanceDraft) => setDrafts((previous) => new Map(previous).set(studentId, draft))
  const revert = (studentId: string) =>
    setDrafts((previous) => {
      const next = new Map(previous)
      next.delete(studentId)
      return next
    })

  const save = async () => {
    const body = planAttendanceSave(sheet.items, drafts)
    if (!body) {
      message.info(t('attendance.nothingChanged'))
      return
    }
    if (problems.size > 0) {
      setShowProblems(true)
      setError(t('attendance.validation.fixRows'))
      return
    }
    if (isBatchTooLarge(body)) {
      setError(t('attendance.validation.tooMany', { max: ATTENDANCE_BATCH_MAX }))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await recordAttendance(sheet.lessonId, body)
      message.success(t('attendance.saved'))
      // The parent replaces the sheet with the server's answer, which remounts this editor (a new session).
      onSaved(saved)
    } catch (caught) {
      setSaving(false)
      const failure = describeAttendanceFailure(caught)
      if (failure.next === 'refused') {
        const ids = failure.studentIds ?? []
        setRefused(new Set(ids))
        setError(failureMessage(t, { ...failure, params: { names: ids.map(nameOf).join(t('lessons.errors.listSeparator')) } }))
        return
      }
      const text = failureMessage(t, failure)
      if (failure.next === 'stale') {
        message.error(text)
        onStale()
        return
      }
      if (failure.next === 'gone') {
        message.error(text)
        onGone()
        return
      }
      setError(text)
    }
  }

  const statusTag = (status: AttendanceStatus) => <Tag color={ATTENDANCE_STATUS_COLORS[status]}>{t(`lessons.attendance.${status}`)}</Tag>

  const columns: TableProps<AttendanceItem>['columns'] = [
    {
      title: t('attendance.columns.student'),
      key: 'student',
      render: (_, item) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{item.student.fullName}</Typography.Text>
          {item.student.displayName && item.student.displayName !== item.student.fullName ? <Typography.Text type="secondary">{item.student.displayName}</Typography.Text> : null}
          <Space size={4} wrap>
            <Tag color={isRecordableItem(item) ? undefined : 'default'}>{t(`attendance.enrollment.${item.enrollmentStatus ?? 'none'}`)}</Tag>
            {item.student.deletedAt ? <Tag color="volcano">{t('attendance.deleted')}</Tag> : null}
            {canRecord && sheet.recordable && !isRecordableItem(item) ? <Tag>{t('attendance.readOnlyRow')}</Tag> : null}
            {refused.has(item.student.id) ? <Tag color="red">{t('attendance.refusedRow')}</Tag> : null}
          </Space>
          {item.record ? (
            // Who wrote the record last, and when — under the name, so the table fits the drawer.
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('attendance.recordedBy', { name: item.record.recordedBy?.fullName ?? '—' })}
              <br />
              {formatDateTime(item.record.updatedAt, language)}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('attendance.columns.status'),
      key: 'status',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isRecordableItem(item)) return item.record ? statusTag(item.record.status) : <Typography.Text type="secondary">{t('attendance.notRecorded')}</Typography.Text>
        return (
          <Radio.Group
            // One radio group per student: a shared generated name would make the whole table one group.
            name={`attendance-status-${item.student.id}`}
            optionType="button"
            buttonStyle="solid"
            size="small"
            value={draft.status}
            disabled={saving}
            onChange={(event) => update(item.student.id, withStatus(draft, event.target.value as AttendanceStatus))}
            options={ATTENDANCE_STATUSES.map((status) => ({ value: status, label: t(`lessons.attendance.${status}`) }))}
            aria-label={`${t('attendance.columns.status')}: ${item.student.fullName}`}
          />
        )
      },
    },
    {
      title: t('attendance.columns.minutesLate'),
      key: 'minutesLate',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isRecordableItem(item)) return item.record?.minutesLate ?? '—'
        const invalid = showProblems && problems.get(item.student.id) === 'minutes_invalid'
        return (
          <Space orientation="vertical" size={0}>
            <InputNumber
              size="small"
              min={1}
              max={MINUTES_LATE_MAX}
              precision={0}
              value={draft.minutesLate}
              disabled={saving || draft.status !== 'late'}
              status={invalid ? 'error' : undefined}
              onChange={(value) => update(item.student.id, { ...draft, minutesLate: typeof value === 'number' ? value : null })}
              aria-label={`${t('attendance.columns.minutesLate')}: ${item.student.fullName}`}
              style={{ width: 84 }}
            />
            {invalid ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {t('attendance.validation.minutesLate', { max: MINUTES_LATE_MAX })}
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
    {
      title: t('attendance.columns.note'),
      key: 'note',
      render: (_, item) => {
        const draft = currentDraft(item, drafts)
        if (!editable || !isRecordableItem(item)) return item.record?.note ? <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.record.note}</Typography.Text> : '—'
        const invalid = showProblems && problems.get(item.student.id) === 'note_too_long'
        return (
          <Space orientation="vertical" size={0}>
            <Input
              size="small"
              maxLength={ATTENDANCE_NOTE_MAX_LENGTH}
              value={draft.note}
              disabled={saving}
              status={invalid ? 'error' : undefined}
              placeholder={t('attendance.notePlaceholder')}
              onChange={(event) => update(item.student.id, { ...draft, note: event.target.value })}
              aria-label={`${t('attendance.columns.note')}: ${item.student.fullName}`}
              style={{ minWidth: 150 }}
            />
            {invalid ? (
              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                {t('attendance.validation.noteTooLong', { max: ATTENDANCE_NOTE_MAX_LENGTH })}
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
  ]
  if (editable) {
    columns.push({
      title: t('common.actions'),
      key: 'actions',
      render: (_, item) =>
        changedIds.has(item.student.id) ? (
          <Button size="small" type="link" icon={<UndoOutlined />} disabled={saving} onClick={() => revert(item.student.id)} aria-label={`${t('attendance.revert')}: ${item.student.fullName}`}>
            {t('attendance.revert')}
          </Button>
        ) : null,
    })
  }

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Tag>{`${t('lessons.attendance.recorded')}: ${sheet.counts.recorded}`}</Tag>
          {ATTENDANCE_STATUSES.map((status) => (
            <Tag key={status} color={ATTENDANCE_STATUS_COLORS[status]}>{`${t(`lessons.attendance.${status}`)}: ${sheet.counts[status]}`}</Tag>
          ))}
        </Space>
        <Typography.Text type="secondary">
          {sheet.attendanceTakenAt ? t('lessons.attendance.takenAt', { date: formatDateTime(sheet.attendanceTakenAt, language) }) : t('lessons.attendance.notTaken')}
        </Typography.Text>
      </Flex>

      {!sheet.recordable && sheet.closedReason ? (
        <Alert type="warning" showIcon title={t(`attendance.closed.${sheet.closedReason}`, { time: formatDateTime(sheet.startsAt, language) })} style={{ marginBottom: 12 }} />
      ) : null}
      {sheet.recordable && !canRecord ? <Alert type="info" showIcon title={t('attendance.readOnly')} style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}

      <Table<AttendanceItem>
        rowKey={(item) => item.student.id}
        columns={columns}
        dataSource={sheet.items}
        loading={loading}
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('attendance.empty') }}
        onRow={(item) => ({ style: refused.has(item.student.id) ? { background: token.colorErrorBg } : undefined })}
      />

      {editable ? (
        <Flex justify="space-between" align="center" wrap gap={8} style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">{changed.length > 0 ? t('attendance.unsaved', { count: changed.length }) : t('attendance.noChanges')}</Typography.Text>
          <Space wrap>
            <Button onClick={() => setDrafts((previous) => markAllPresent(sheet.items, previous))} disabled={saving || unrecorded.length === 0} title={t('attendance.markAllPresentHint')}>
              {t('attendance.markAllPresent')}
            </Button>
            {changed.length > 0 ? (
              <Popconfirm title={t('attendance.reloadConfirm')} okText={t('attendance.reload')} cancelText={t('common.cancel')} onConfirm={onReload}>
                <Button icon={<ReloadOutlined />} disabled={saving}>
                  {t('attendance.reload')}
                </Button>
              </Popconfirm>
            ) : (
              <Button icon={<ReloadOutlined />} disabled={saving} onClick={onReload}>
                {t('attendance.reload')}
              </Button>
            )}
            <Button type="primary" loading={saving} disabled={changed.length === 0} onClick={() => void save()}>
              {t('attendance.save')}
            </Button>
          </Space>
        </Flex>
      ) : (
        <Flex justify="flex-end" style={{ marginTop: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={onReload}>
            {t('attendance.reload')}
          </Button>
        </Flex>
      )}
    </>
  )
}
