// The rooms tab of the settings page (J-F06, MOD-07-T02 screen, API-084..API-087):
// the list the server orders (the academy's own site first, then by branch
// code, then by room code) with the server filters `branchId` (a branch, or
// the site alone) and `kind`, a local text search and a local status filter
// (API-084 has neither), create/edit through RoomModal, and the row actions —
// activate/deactivate (API-086 `isActive`) and delete behind a confirmation (a
// room a weekly slot uses gets the server's `room_in_use` message with its
// count). Every write is followed by a re-read of the list: the order and the
// branch names come from the server. The tab is management-only by design: the
// route (`guarded('rooms')`) and SettingsPage (`RequireAccess
// permission="schedule.manage"`) mount it for holders of `schedule.manage` only,
// so it has no read-only mode (J-F20); the server stays the boundary.
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteRoom, NO_BRANCH_FILTER, ROOM_KINDS, updateRoom } from '../api/rooms'
import type { Room, RoomKind } from '../api/rooms'
import { useBranches } from '../branches/useBranches'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { RoomModal } from './RoomModal'
import { describeRoomsFailure, failureMessage } from './rooms.errors'
import { branchLabel, EMPTY_LOCAL_FILTERS, filterRooms, roomDisplayName } from './rooms.form'
import type { LocalRoomFilters, RoomStatusFilter } from './rooms.form'
import { useRooms } from './useRooms'

const EMPTY = '—'
const STATUS_FILTERS: readonly RoomStatusFilter[] = ['active', 'inactive']

export function RoomsManager() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const list = useRooms()
  // J-F03's branch list (API-080), shared with the branches tab: the branch filter and the form's picker. A failure
  // leaves an empty list — the filter offers the site alone, the form still names a room's own branch — and warns.
  const branchesState = useBranches()
  const [local, setLocal] = useState<LocalRoomFilters>(EMPTY_LOCAL_FILTERS)
  const [editing, setEditing] = useState<Room | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const nameOf = (room: Room) => roomDisplayName(room, language)

  /** Runs one write, then re-reads the list — after a refusal too (the list may be stale). */
  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await task()
      message.success(success)
    } catch (caught) {
      message.error(failureMessage(t, describeRoomsFailure(caught)))
    } finally {
      setBusy(false)
      list.reload()
    }
  }

  const activate = (room: Room) => run(() => updateRoom(room.id, { isActive: true }), t('rooms.activated', { name: nameOf(room) }))
  const deactivate = (room: Room) => run(() => updateRoom(room.id, { isActive: false }), t('rooms.deactivated', { name: nameOf(room) }))
  const remove = (room: Room) => run(() => deleteRoom(room.id), t('rooms.deleted', { name: nameOf(room) }))

  const saved = (room: Room, created: boolean) => {
    setEditing(null)
    message.success(created ? t('rooms.created', { name: nameOf(room) }) : t('rooms.saved'))
    list.reload()
  }

  const visible = filterRooms(list.rooms, local)
  const filtered = visible.length !== list.rooms.length
  // A server filter can empty the list too: then "no match", not "no rooms yet" (found in the real-server run, CH-0069).
  const serverFiltered = Boolean(list.filters.branchId || list.filters.kind)

  const columns: TableProps<Room>['columns'] = [
    {
      title: t('rooms.columns.code'),
      key: 'code',
      render: (_, row) => (
        <Typography.Text dir="ltr" strong>
          {row.code}
        </Typography.Text>
      ),
    },
    {
      title: t('rooms.columns.name'),
      key: 'name',
      render: (_, row) => (row.name ? localizedLabel(row.name, language) : <Typography.Text type="secondary">{EMPTY}</Typography.Text>),
    },
    { title: t('rooms.columns.kind'), key: 'kind', render: (_, row) => <Tag>{t(`rooms.kinds.${row.kind}`)}</Tag> },
    {
      title: t('rooms.columns.branch'),
      key: 'branch',
      render: (_, row) => (row.branch ? branchLabel(row.branch, language) : <Typography.Text type="secondary">{t('rooms.site')}</Typography.Text>),
    },
    { title: t('rooms.columns.capacity'), key: 'capacity', align: 'center', render: (_, row) => row.capacity ?? EMPTY },
    { title: t('rooms.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row) => {
        const name = nameOf(row)
        return (
          <Space size={4} wrap>
            <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${row.code}`} disabled={busy} onClick={() => setEditing(row)} />
            {row.isActive ? (
              <Popconfirm
                title={t('rooms.actions.deactivateConfirm', { name })}
                okText={t('rooms.actions.deactivate')}
                cancelText={t('common.cancel')}
                onConfirm={() => deactivate(row)}
              >
                <Button size="small" icon={<StopOutlined />} aria-label={`${t('rooms.actions.deactivate')}: ${row.code}`} disabled={busy} />
              </Popconfirm>
            ) : (
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                aria-label={`${t('rooms.actions.activate')}: ${row.code}`}
                disabled={busy}
                onClick={() => void activate(row)}
              />
            )}
            <Popconfirm
              title={t('rooms.actions.deleteConfirm', { name })}
              okText={t('rooms.actions.delete')}
              okButtonProps={{ danger: true }}
              cancelText={t('common.cancel')}
              onConfirm={() => remove(row)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} aria-label={`${t('rooms.actions.delete')}: ${row.code}`} disabled={busy} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const branchFilterOptions = [
    { value: NO_BRANCH_FILTER, label: t('rooms.site') },
    ...branchesState.branches.map((branch) => ({
      value: branch.id,
      label: branch.isActive ? branchLabel(branch, language) : `${branchLabel(branch, language)} (${t('labels.inactive')})`,
    })),
  ]

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t('rooms.hint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('rooms.refresh')} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('rooms.add')}
          </Button>
        </Space>
      </Flex>

      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t('rooms.searchPlaceholder')}
          aria-label={t('common.search')}
          value={local.q}
          onChange={(event) => setLocal((current) => ({ ...current, q: event.target.value }))}
          onSearch={(value) => setLocal((current) => ({ ...current, q: value }))}
          style={{ maxWidth: 280 }}
        />
        <Select<string>
          allowClear
          placeholder={t('rooms.allBranches')}
          aria-label={t('rooms.columns.branch')}
          value={list.filters.branchId}
          onChange={(value) => list.setFilters({ branchId: value })}
          options={branchFilterOptions}
          loading={branchesState.loading}
          style={{ minWidth: 200 }}
        />
        <Select<RoomKind>
          allowClear
          placeholder={t('rooms.allKinds')}
          aria-label={t('rooms.columns.kind')}
          value={list.filters.kind}
          onChange={(value) => list.setFilters({ kind: value })}
          options={ROOM_KINDS.map((kind) => ({ value: kind, label: t(`rooms.kinds.${kind}`) }))}
          style={{ minWidth: 150 }}
        />
        <Select<RoomStatusFilter>
          allowClear
          placeholder={t('rooms.allStatuses')}
          aria-label={t('rooms.columns.status')}
          value={local.status === 'all' ? undefined : local.status}
          onChange={(value) => setLocal((current) => ({ ...current, status: value ?? 'all' }))}
          options={STATUS_FILTERS.map((status) => ({ value: status, label: t(`labels.${status}`) }))}
          style={{ minWidth: 140 }}
        />
      </Flex>

      {list.error ? (
        <Alert
          type="error"
          showIcon
          message={t('rooms.loadFailed')}
          description={failureMessage(t, describeRoomsFailure(list.error))}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={list.reload} loading={list.loading}>
              {t('rooms.retry')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {branchesState.error ? <Alert type="warning" showIcon message={t('rooms.branchesFailed')} style={{ marginBottom: 16 }} /> : null}

      <Table<Room>
        rowKey="id"
        columns={columns}
        dataSource={visible}
        loading={list.loading || busy}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: visible.length === 0 && (list.rooms.length > 0 || serverFiltered) ? t('rooms.noMatch') : t('rooms.empty') }}
        footer={filtered ? () => <Typography.Text type="secondary">{t('rooms.shown', { shown: visible.length, total: list.rooms.length })}</Typography.Text> : undefined}
      />

      {/* Mounted per session: its form starts from the chosen room, never from the values of an earlier session (KI-049). */}
      {editing !== null ? (
        <RoomModal
          key={editing === 'new' ? 'new' : editing.id}
          open
          room={editing === 'new' ? null : editing}
          branches={branchesState.branches}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}
    </Card>
  )
}
