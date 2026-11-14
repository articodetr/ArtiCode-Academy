// The «attendance» tab of the lesson drawer (J-F10): the sheet of API-099 —
// one row per student with their enrollment status and record — and, for a
// holder of `attendance.record` while the server says `recordable`, an editor
// that saves the changed rows in ONE PUT (API-100). Each row is sent as the
// whole new state of that record; nothing is sent when no row changed; the
// screen shows the server's answer only (no optimistic rows), then the lesson's
// counts follow it in the drawer and the list. A student whose enrollment is
// not active or completed (withdrawn after the lesson, cancelled…) stays
// listed read-only — the server refuses them with `not_enrolled`. Its times
// (the lesson's start, when the sheet and each record were written) are in the
// lesson's `timeZone`, as everywhere in the drawer (D-R41 — J-F28), and the
// tab names that zone with this device's beside it when they differ, as the
// details tab does (J-F48 — the owner's note 1 on #105). Since
// J-F40 (KI-058) the editor reports through `onUnsavedChange` whether a row
// differs from the server's record — the save would send it — so the drawer
// keeps it on Escape, a mask click, the close button, a browser back/forward
// and a reload; a row changed back holds nothing, a read-only sheet never
// holds, and the saved answer starts a clean session.
import { ReloadOutlined, UndoOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Input, InputNumber, Popconfirm, Radio, Skeleton, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ATTENDANCE_BATCH_MAX, ATTENDANCE_NOTE_MAX_LENGTH, ATTENDANCE_STATUSES, MINUTES_LATE_MAX, recordAttendance } from '../api/attendance'
import type { AttendanceItem, AttendanceSheet, AttendanceStatus } from '../api/attendance'
import type { Lesson } from '../api/lessons'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { LessonZoneValue } from '../lessons/LessonZone'
import { differsFromDevice, formatLessonDateTime } from '../lessons/lessons.format'
import { changedItems, currentDraft, draftProblem, isBatchTooLarge, isRecordableItem, markAllPresent, planAttendanceSave, unrecordedItems, withStatus } from './attendance.changes'
import type { AttendanceDraft } from './attendance.changes'
import { describeAttendanceFailure, failureMessage } from './attendance.errors'
import { ATTENDANCE_STATUS_COLORS } from './attendance.format'
import { useAttendanceSheet } from './useAttendanceSheet'
import './attendance.css'

interface AttendanceSheetTabProps {
  /** The lesson's id, and its zone for the times the sheet shows. */
  lesson: Pick<Lesson, 'id' | 'timeZone'>
  /** The sheet the server answered after a save: its counts update the lesson in the drawer and in the list. */
  onSaved: (sheet: AttendanceSheet) => void
  /** The lesson changed elsewhere (cancelled, not started, gone): the drawer re-reads it. */
  onLessonStale: () => void
  /** Whether a row holds a change the save would send (KI-058): reported on every change, false once saved or left. */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function AttendanceSheetTab({ lesson, onSaved, onLessonStale, onUnsavedChange }: AttendanceSheetTabProps) {
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
          timeZone={lesson.timeZone}
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
          onUnsavedChange={onUnsavedChange}
        />
      ) : null}
    </div>
  )
}

interface AttendanceEditorProps {
  sheet: AttendanceSheet
  /** The lesson's zone (D-R41). */
  timeZone: string
  canRecord: boolean
  loading: boolean
  onSaved: (sheet: AttendanceSheet) => void
  onStale: () => void
  onGone: () => void
  onReload: () => void
  onUnsavedChange?: (unsaved: boolean) => void
}

function AttendanceEditor({ sheet, timeZone, canRecord, loading, onSaved, onStale, onGone, onReload, onUnsavedChange }: AttendanceEditorProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [drafts, setDrafts] = useState<ReadonlyMap<string, AttendanceDraft>>(() => new Map())
  const [refused, setRefused] = useState<ReadonlySet<string>>(() => new Set())
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Rows whose note field the user opened with «add note» (a row that holds a note always shows it).
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set())

  const editable = canRecord && sheet.recordable
  const changed = changedItems(sheet.items, drafts)
  const changedIds = new Set(changed.map((item) => item.student.id))
  const problems = new Map(changed.flatMap((item) => {
    const problem = draftProblem(currentDraft(item, drafts))
    return problem ? [[item.student.id, problem] as const] : []
  }))
  const unrecorded = editable ? unrecordedItems(sheet.items, drafts) : []
  const nameOf = (studentId: string) => sheet.items.find((item) => item.student.id === studentId)?.student.fullName ?? studentId

  // KI-058: rows the save would send are unsaved work — compared with the server's records, so a row
  // changed back holds nothing; a read-only sheet never holds. False when the editor leaves: the saved
  // answer (or a reload) starts a new session, keyed by the sheet's version (KI-049).
  const unsaved = editable && planAttendanceSave(sheet.items, drafts) !== null
  useEffect(() => {
    onUnsavedChange?.(unsaved)
    return () => onUnsavedChange?.(false)
  }, [unsaved, onUnsavedChange])

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

  // Redesign (2026-11-14): one compact row per student instead of a five-column table, so the sheet fits the
  // docked side panel and a phone — the status buttons beside the name, the minutes only for «late», the note
  // behind «add note» unless the row already holds one, and the save bar pinned to the bottom of the drawer.
  const renderRow = (item: AttendanceItem) => {
    const draft = currentDraft(item, drafts)
    const recordable = editable && isRecordableItem(item)
    const id = item.student.id
    const minutesInvalid = showProblems && problems.get(id) === 'minutes_invalid'
    const noteInvalid = showProblems && problems.get(id) === 'note_too_long'
    const showNote = recordable && (openNotes.has(id) || Boolean(item.record?.note) || draft.note.length > 0 || noteInvalid)
    const classes = ['att-row']
    if (refused.has(id)) classes.push('att-row--refused')
    if (changedIds.has(id)) classes.push('att-row--changed')
    return (
      <li key={id} className={classes.join(' ')} data-attendance-row={id}>
        <div className="att-row__main">
          <div className="att-row__who">
            <Typography.Text strong>{item.student.fullName}</Typography.Text>
            {item.student.displayName && item.student.displayName !== item.student.fullName ? <Typography.Text type="secondary"> ({item.student.displayName})</Typography.Text> : null}
            {item.enrollmentStatus !== 'active' || item.student.deletedAt || refused.has(id) || (canRecord && sheet.recordable && !isRecordableItem(item)) ? (
              <div className="att-row__tags">
                {item.enrollmentStatus !== 'active' ? <Tag>{t(`attendance.enrollment.${item.enrollmentStatus ?? 'none'}`)}</Tag> : null}
                {item.student.deletedAt ? <Tag color="volcano">{t('attendance.deleted')}</Tag> : null}
                {canRecord && sheet.recordable && !isRecordableItem(item) ? <Tag>{t('attendance.readOnlyRow')}</Tag> : null}
                {refused.has(id) ? <Tag color="red">{t('attendance.refusedRow')}</Tag> : null}
              </div>
            ) : null}
            {item.record ? (
              <div className="att-row__meta">
                {`${t('attendance.recordedBy', { name: item.record.recordedBy?.fullName ?? '—' })} · ${formatLessonDateTime(item.record.updatedAt, language, timeZone)}`}
              </div>
            ) : null}
          </div>
          <div className="att-row__status">
            {recordable ? (
              <Radio.Group
                // One radio group per student: a shared generated name would make the whole sheet one group.
                name={`attendance-status-${id}`}
                optionType="button"
                buttonStyle="solid"
                value={draft.status}
                disabled={saving}
                onChange={(event) => update(id, withStatus(draft, event.target.value as AttendanceStatus))}
                options={ATTENDANCE_STATUSES.map((status) => ({ value: status, label: t(`lessons.attendance.${status}`) }))}
                aria-label={`${t('attendance.columns.status')}: ${item.student.fullName}`}
              />
            ) : item.record ? (
              <>
                {statusTag(item.record.status)}
                {item.record.minutesLate ? <span className="att-row__meta tabular-nums">{t('attendance.minutesShort', { count: item.record.minutesLate })}</span> : null}
              </>
            ) : (
              <Typography.Text type="secondary">{t('attendance.notRecorded')}</Typography.Text>
            )}
          </div>
        </div>
        {!recordable && item.record?.note ? <div className="att-row__note-text">{item.record.note}</div> : null}
        {recordable ? (
          <div className="att-row__extra">
            {draft.status === 'late' ? (
              <label className="att-row__minutes">
                <span>{t('attendance.columns.minutesLate')}</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={MINUTES_LATE_MAX}
                  precision={0}
                  value={draft.minutesLate}
                  disabled={saving}
                  status={minutesInvalid ? 'error' : undefined}
                  onChange={(value) => update(id, { ...draft, minutesLate: typeof value === 'number' ? value : null })}
                  aria-label={`${t('attendance.columns.minutesLate')}: ${item.student.fullName}`}
                  style={{ width: 72 }}
                />
              </label>
            ) : null}
            {showNote ? (
              <Input
                size="small"
                className="att-row__note"
                maxLength={ATTENDANCE_NOTE_MAX_LENGTH}
                value={draft.note}
                disabled={saving}
                status={noteInvalid ? 'error' : undefined}
                placeholder={t('attendance.notePlaceholder')}
                onChange={(event) => update(id, { ...draft, note: event.target.value })}
                aria-label={`${t('attendance.columns.note')}: ${item.student.fullName}`}
                autoFocus={openNotes.has(id) && draft.note.length === 0}
              />
            ) : (
              <Button size="small" type="link" className="att-row__add-note" disabled={saving} onClick={() => setOpenNotes((previous) => new Set(previous).add(id))} aria-label={`${t('attendance.addNote')}: ${item.student.fullName}`}>
                {t('attendance.addNote')}
              </Button>
            )}
            {changedIds.has(id) ? (
              <Button size="small" type="link" icon={<UndoOutlined />} disabled={saving} onClick={() => revert(id)} aria-label={`${t('attendance.revert')}: ${item.student.fullName}`}>
                {t('attendance.revert')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {minutesInvalid ? <Typography.Text type="danger" className="att-row__error">{t('attendance.validation.minutesLate', { max: MINUTES_LATE_MAX })}</Typography.Text> : null}
        {noteInvalid ? <Typography.Text type="danger" className="att-row__error">{t('attendance.validation.noteTooLong', { max: ATTENDANCE_NOTE_MAX_LENGTH })}</Typography.Text> : null}
      </li>
    )
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
          {sheet.attendanceTakenAt ? t('lessons.attendance.takenAt', { date: formatLessonDateTime(sheet.attendanceTakenAt, language, timeZone) }) : t('lessons.attendance.notTaken')}
        </Typography.Text>
      </Flex>
      {differsFromDevice(timeZone) ? (
        // The times below are the lesson's zone, not this device's: say which, as the details tab does.
        <Typography.Paragraph type="secondary" data-testid="attendance-zone" style={{ marginBottom: 12 }}>
          {`${t('lessons.fields.timeZone')}: `}
          <LessonZoneValue timeZone={timeZone} />
        </Typography.Paragraph>
      ) : null}

      {!sheet.recordable && sheet.closedReason ? (
        <Alert
          type="warning"
          showIcon
          title={t(`attendance.closed.${sheet.closedReason}`, { time: formatLessonDateTime(sheet.startsAt, language, timeZone) })}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      {sheet.recordable && !canRecord ? <Alert type="info" showIcon title={t('attendance.readOnly')} style={{ marginBottom: 12 }} /> : null}
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}

      {loading && !sheet.items.length ? <Skeleton active paragraph={{ rows: 4 }} title={false} /> : null}
      {sheet.items.length ? <ul className="att-list">{sheet.items.map(renderRow)}</ul> : !loading ? <Typography.Paragraph type="secondary">{t('attendance.empty')}</Typography.Paragraph> : null}

      {editable ? (
        <Flex justify="space-between" align="center" wrap gap={8} className="att-savebar">
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
