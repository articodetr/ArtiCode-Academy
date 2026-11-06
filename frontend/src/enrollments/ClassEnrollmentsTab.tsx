// Students tab of the class drawer (J-F04 on API-057..API-059). Whoever may
// read the roster (the drawer decides: `enrollments.read` plus
// `enrollments.manage` or an assignment to the class — the server stays the
// boundary with 404) sees the enrollments with a server-side status filter, a
// local name filter (API-057 has no search) and keyset pages. Holders of
// `enrollments.manage` enroll a student found through the student search
// (API-012 `role=student`, needs `users.read`) and run the enrollment actions
// (withdraw / complete / cancel / reactivate), each confirmed with an optional
// reason. The server answers with the enrollment, not the class, so the tab
// moves the class's `enrolledCount` itself (enrolledCountDelta) and hands the
// class back to the drawer. The refresh button re-reads both the roster and
// the class, so the seats shown beside the roster match the server too.
import { DownOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons'
import { Alert, App, Button, Dropdown, Flex, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import type { MenuProps, TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AcademyClass } from '../api/classes'
import { ENROLLMENT_STATUSES, changeEnrollmentStatus, enrollStudent } from '../api/enrollments'
import type { Enrollment, EnrollmentStatus, EnrollmentStatusAction } from '../api/enrollments'
import type { UserListItem } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { SeatsBar } from '../classes/SeatsBar'
import { describeClassesFailure, failureMessage } from '../classes/classes.errors'
import { StatusTag } from '../components/StatusTag'
import { directionOf } from '../i18n/language'
import type { Direction } from '../i18n/language'
import { useLocalized } from '../i18n/useLocalized'
import { displayNameOf, formatDateTime } from '../users/users.format'
import {
  ENROLLMENT_REASON_MAX_LENGTH,
  availableEnrollmentActions,
  enrolledCountDelta,
  hasFreeSeat,
  isDangerousEnrollmentAction,
  isEnrollableClass,
  matchesRosterSearch,
  nextEnrollmentStatus,
  studentRefusal,
  takesSeat,
} from './enrollments.status'
import { useClassEnrollments } from './useClassEnrollments'

const DASH = '—'

/** Server codes after which the class on screen is out of date (count, status) and must be re-read. */
const STALE_CLASS_CODES = new Set(['class_full', 'class_not_enrollable'])
/** Server codes after which the roster on screen is out of date. */
const STALE_ROSTER_CODES = new Set(['already_enrolled', 'invalid_transition', 'enrollment_not_found'])

/** «from → to» in the reading direction: arrows are not mirrored by the bidi algorithm, so RTL needs its own. */
const TRANSITION_ARROW: Readonly<Record<Direction, string>> = { rtl: '←', ltr: '→' }

interface ClassEnrollmentsTabProps {
  cls: AcademyClass
  /** The class with its `enrolledCount` moved by a write (the server returns the enrollment only). */
  onClassChanged: (cls: AcademyClass) => void
  /** The class changed elsewhere (full, no longer enrollable) or the user asked for a refresh: re-read it. */
  onStale: () => void
}

/** The timestamp that explains the current status. */
function sinceOf(row: Enrollment): string | null {
  switch (row.status) {
    case 'active':
      return row.activatedAt
    case 'withdrawn':
      return row.withdrawnAt
    case 'completed':
      return row.completedAt
    default:
      return row.updatedAt
  }
}

export function ClassEnrollmentsTab({ cls, onClassChanged, onStale }: ClassEnrollmentsTabProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('enrollments.manage')
  const canSearch = hasPermission('users.read')
  const canReadContact = hasPermission('users.read_contact')
  const list = useClassEnrollments(cls.id)
  const [search, setSearch] = useState('')
  const [candidate, setCandidate] = useState<UserListItem | undefined>(undefined)
  // A new key remounts the search after each enrollment, so it starts empty again (as the teachers editor).
  const [pickerKey, setPickerKey] = useState(0)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ row: Enrollment; action: EnrollmentStatusAction } | null>(null)

  const moveCount = (from: EnrollmentStatus | null, to: EnrollmentStatus) => {
    const delta = enrolledCountDelta(from, to)
    if (delta !== 0) onClassChanged({ ...cls, enrolledCount: cls.enrolledCount + delta })
  }

  const afterFailure = (code: string | undefined) => {
    if (code && STALE_CLASS_CODES.has(code)) onStale()
    if (code && STALE_ROSTER_CODES.has(code)) list.reload()
  }

  const refusalOf = (user: UserListItem): string | undefined => {
    const refusal = studentRefusal(user, list.items)
    return refusal ? t(`classes.enrollments.refusals.${refusal}`) : undefined
  }

  const enroll = async () => {
    if (!candidate || studentRefusal(candidate, list.items)) return
    setEnrolling(true)
    setEnrollError(null)
    try {
      const created = await enrollStudent(cls.id, { studentId: candidate.id })
      message.success(t('classes.enrollments.enrolled', { name: displayNameOf(created.student) }))
      setCandidate(undefined)
      setPickerKey((key) => key + 1)
      list.reload()
      moveCount(null, created.status)
    } catch (caught) {
      const failure = describeClassesFailure(caught, (userId) => (userId === candidate.id ? displayNameOf(candidate) : undefined))
      setEnrollError(failureMessage(t, failure))
      afterFailure(failure.key.split('.').pop())
    } finally {
      setEnrolling(false)
    }
  }

  const listFailure = list.error ? describeClassesFailure(list.error) : null
  const visible = list.items.filter((row) => matchesRosterSearch(row, search))
  const filtered = Boolean(search.trim() || list.filters.status)
  const enrollable = isEnrollableClass(cls.status)
  const seatFree = hasFreeSeat(cls.capacity, cls.enrolledCount)

  const columns: TableProps<Enrollment>['columns'] = [
    {
      title: t('classes.enrollments.columns.student'),
      key: 'student',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Space size={4} wrap>
            <Typography.Text strong={row.student.deletedAt === null} delete={row.student.deletedAt !== null}>
              {displayNameOf(row.student)}
            </Typography.Text>
            {row.student.deletedAt !== null ? <Tag>{t('classes.enrollments.deletedAccount')}</Tag> : null}
          </Space>
          {canReadContact && row.student.email ? (
            <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
              {row.student.email}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    { title: t('common.status'), key: 'status', render: (_, row) => <StatusTag value={row.status} /> },
    { title: t('classes.enrollments.columns.enrolledAt'), key: 'enrolledAt', render: (_, row) => formatDateTime(row.enrolledAt, language) },
    { title: t('classes.enrollments.columns.since'), key: 'since', render: (_, row) => formatDateTime(sinceOf(row), language) },
  ]
  if (canManage) {
    columns.push({
      title: t('classes.enrollments.columns.reason'),
      key: 'reason',
      render: (_, row) => (row.withdrawalReason ? <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{row.withdrawalReason}</Typography.Text> : DASH),
    })
    columns.push({
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const actions = availableEnrollmentActions(row.status, canManage)
        if (actions.length === 0) return DASH
        const items: MenuProps['items'] = actions.map((action) => ({
          key: action,
          label: t(`classes.enrollments.actions.${action}`),
          danger: isDangerousEnrollmentAction(action),
        }))
        return (
          <Dropdown trigger={['click']} destroyOnHidden menu={{ items, onClick: ({ key }) => setPending({ row, action: key as EnrollmentStatusAction }) }}>
            <Button size="small" icon={<DownOutlined />} iconPlacement="end" aria-label={`${t('classes.enrollments.actions.menu')}: ${displayNameOf(row.student)}`}>
              {t('classes.enrollments.actions.menu')}
            </Button>
          </Dropdown>
        )
      },
    })
  }

  return (
    <>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{t('classes.enrollments.seats')}</Typography.Text>
        <SeatsBar cls={cls} />
      </Flex>

      {!canManage ? <Alert type="info" showIcon message={t('classes.enrollments.readOnlyHint')} style={{ marginBottom: 12 }} /> : null}

      {canManage ? (
        <div style={{ marginBottom: 12 }}>
          {!enrollable ? (
            <Alert type="info" showIcon message={t('classes.enrollments.notEnrollable', { status: t(`labels.${cls.status}`) })} />
          ) : !seatFree ? (
            <Alert type="warning" showIcon message={t('classes.enrollments.full', { enrolledCount: cls.enrolledCount, capacity: cls.capacity })} />
          ) : !canSearch ? (
            <Alert type="info" showIcon message={t('classes.enrollments.searchNeedsUsersRead')} />
          ) : (
            <Flex gap={8} wrap>
              <StudentPicker
                key={pickerKey}
                value={candidate?.id}
                onChange={(_value, chosen) => {
                  setCandidate(chosen)
                  setEnrollError(null)
                }}
                refusalOf={refusalOf}
                disabled={enrolling}
                placeholder={t('classes.enrollments.pickStudent')}
                aria-label={t('classes.enrollments.add')}
                style={{ flex: 1, minWidth: 240 }}
              />
              <Button type="primary" icon={<UserAddOutlined />} onClick={() => void enroll()} loading={enrolling} disabled={!candidate}>
                {t('classes.enrollments.enroll')}
              </Button>
            </Flex>
          )}
          {enrollError ? <Alert type="error" showIcon message={enrollError} style={{ marginTop: 8 }} /> : null}
        </div>
      ) : null}

      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          placeholder={t('classes.enrollments.searchPlaceholder')}
          aria-label={t('classes.enrollments.searchLabel')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 260 }}
        />
        <Select<EnrollmentStatus | undefined>
          allowClear
          placeholder={t('classes.enrollments.allStatuses')}
          aria-label={t('common.status')}
          value={list.filters.status}
          onChange={(value) => list.setFilters({ status: value })}
          options={ENROLLMENT_STATUSES.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
          style={{ minWidth: 150 }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            list.reload()
            onStale()
          }}
          aria-label={t('classes.enrollments.refresh')}
        />
      </Flex>

      {listFailure ? (
        <Alert
          type="error"
          showIcon
          message={failureMessage(t, listFailure)}
          action={
            <Button size="small" onClick={() => (listFailure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
              {t('classes.enrollments.refresh')}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Table<Enrollment>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={visible}
        loading={list.loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: filtered ? t('classes.enrollments.emptyFiltered') : t('classes.enrollments.empty') }}
      />

      {list.canGoBack || list.nextCursor ? (
        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">{t('classes.enrollments.pagination.page', { page: list.pageNumber })}</Typography.Text>
          <Space>
            <Button size="small" onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('classes.enrollments.pagination.previous')}
            </Button>
            <Button size="small" onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('classes.enrollments.pagination.next')}
            </Button>
          </Space>
        </Flex>
      ) : null}

      {pending ? (
        <EnrollmentActionModal
          // Mounted per action, so the reason never carries over to the next one.
          cls={cls}
          row={pending.row}
          action={pending.action}
          onDone={(updated) => {
            setPending(null)
            list.replaceItem(updated)
            moveCount(pending.row.status, updated.status)
          }}
          onFailed={(code) => afterFailure(code)}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </>
  )
}

interface EnrollmentActionModalProps {
  cls: AcademyClass
  row: Enrollment
  action: EnrollmentStatusAction
  onDone: (updated: Enrollment) => void
  /** The server refused with this code (the dialog stays open with the message). */
  onFailed: (code: string | undefined) => void
  onCancel: () => void
}

function EnrollmentActionModal({ cls, row, action, onDone, onFailed, onCancel }: EnrollmentActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = displayNameOf(row.student)
  const warnFull = takesSeat(action) && !hasFreeSeat(cls.capacity, cls.enrolledCount)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const trimmed = reason.trim()
      const updated = await changeEnrollmentStatus(row.id, trimmed ? { action, reason: trimmed } : { action })
      message.success(t(`classes.enrollments.done.${action}`))
      onDone(updated)
    } catch (caught) {
      const failure = describeClassesFailure(caught, (userId) => (userId === row.student.id ? name : undefined))
      setError(failureMessage(t, failure))
      onFailed(failure.key.split('.').pop())
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('classes.enrollments.confirm.title', { action: t(`classes.enrollments.actions.${action}`), name })}
      okText={t(`classes.enrollments.actions.${action}`)}
      okButtonProps={{ danger: isDangerousEnrollmentAction(action) }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>
        {t(`classes.enrollments.confirm.${action}`)}{' '}
        <StatusTag value={row.status} /> {TRANSITION_ARROW[directionOf(language)]} <StatusTag value={nextEnrollmentStatus(action, row.status) ?? row.status} />
      </Typography.Paragraph>
      {warnFull ? (
        <Alert type="warning" showIcon message={t('classes.enrollments.confirm.reactivateFull', { enrolledCount: cls.enrolledCount, capacity: cls.capacity })} style={{ marginBottom: 12 }} />
      ) : null}
      <Form layout="vertical">
        <Form.Item label={t('classes.enrollments.confirm.reason')} extra={t('classes.enrollments.confirm.reasonHint')} htmlFor="enrollment-status-reason">
          <Input.TextArea
            id="enrollment-status-reason"
            rows={2}
            maxLength={ENROLLMENT_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
