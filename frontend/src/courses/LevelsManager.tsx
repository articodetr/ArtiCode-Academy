// The levels tab of the courses page (MOD-04-T06), for holders of
// `courses.manage`: the ordered table (API-037 manager view with course
// counts), create/edit through LevelModal, up/down arrows that send the whole
// new order (API-041), and delete (API-040) — refused for a level in use: the
// button is disabled with the reason, and a stale count still gets the
// server's `level_in_use` message. Rows come from server answers only.
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteLevel, reorderLevels } from '../api/levels'
import type { Level } from '../api/levels'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { LevelModal } from './LevelModal'
import { moveLevel } from './levels.form'
import type { LevelsState } from './useLevels'

interface LevelsManagerProps {
  state: LevelsState
  /** Called after every successful write (the courses list shows level names). */
  onChanged?: () => void
}

export function LevelsManager({ state, onChanged }: LevelsManagerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { levels, loading, error, reload, setLevels } = state
  const [editing, setEditing] = useState<Level | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = (caught: unknown) => {
    message.error(failureMessage(t, describeCoursesFailure(caught)))
    // A stale list (a level gone or in use, an order changed elsewhere): show the server's.
    reload()
  }

  const move = async (index: number, delta: -1 | 1) => {
    const order = moveLevel(levels, index, delta)
    if (!order) return
    setBusy(true)
    try {
      setLevels((await reorderLevels(order)).items)
      message.success(t('courses.levels.reordered'))
      onChanged?.()
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (level: Level) => {
    setBusy(true)
    try {
      await deleteLevel(level.id)
      setLevels(levels.filter((item) => item.id !== level.id))
      message.success(t('courses.levels.deleted'))
      onChanged?.()
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  const saved = (level: Level, created: boolean) => {
    setEditing(null)
    setLevels(created ? [...levels, level] : levels.map((item) => (item.id === level.id ? level : item)))
    message.success(created ? t('courses.levels.created', { name: localizedLabel(level.name, language) }) : t('courses.levels.saved'))
    onChanged?.()
  }

  const columns: TableProps<Level>['columns'] = [
    { title: t('courses.levels.columns.order'), key: 'order', width: 56, render: (_, _row, index) => index + 1 },
    {
      title: t('courses.levels.columns.code'),
      key: 'code',
      render: (_, row) => (
        <Typography.Text dir="ltr" strong>
          {row.code}
        </Typography.Text>
      ),
    },
    {
      title: t('courses.levels.columns.name'),
      key: 'name',
      render: (_, row) => (
        <Flex vertical>
          <span>{localizedLabel(row.name, language)}</span>
          {row.description ? <Typography.Text type="secondary">{localizedLabel(row.description, language)}</Typography.Text> : null}
        </Flex>
      ),
    },
    { title: t('courses.levels.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
    { title: t('courses.levels.columns.courseCount'), key: 'courseCount', render: (_, row) => row.courseCount ?? '—' },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row, index) => {
        const inUse = (row.courseCount ?? 0) > 0
        const deleteLabel = `${t('courses.levels.delete')}: ${row.code}`
        return (
          <Space size={4} wrap>
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              aria-label={`${t('courses.levels.moveUp')}: ${row.code}`}
              disabled={busy || index === 0}
              onClick={() => void move(index, -1)}
            />
            <Button
              size="small"
              icon={<ArrowDownOutlined />}
              aria-label={`${t('courses.levels.moveDown')}: ${row.code}`}
              disabled={busy || index === levels.length - 1}
              onClick={() => void move(index, 1)}
            />
            <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${row.code}`} disabled={busy} onClick={() => setEditing(row)} />
            {inUse ? (
              <Tooltip title={t('courses.errors.level_in_use', { courseCount: String(row.courseCount) })}>
                <span>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled />
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('courses.levels.deleteConfirm', { name: localizedLabel(row.name, language) })}
                okText={t('courses.levels.delete')}
                okButtonProps={{ danger: true }}
                cancelText={t('common.cancel')}
                onConfirm={() => remove(row)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled={busy} />
              </Popconfirm>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">{t('courses.levels.hint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('courses.refresh')} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('courses.levels.add')}
          </Button>
        </Space>
      </Flex>

      {error ? <Alert type="error" showIcon message={failureMessage(t, describeCoursesFailure(error))} style={{ marginBottom: 16 }} /> : null}

      <Table<Level>
        rowKey="id"
        columns={columns}
        dataSource={levels}
        loading={loading || busy}
        pagination={false}
        locale={{ emptyText: t('courses.levels.empty') }}
      />

      {/* Mounted per session: its form starts from the chosen level, never from the values of an earlier session. */}
      {editing !== null ? (
        <LevelModal key={editing === 'new' ? 'new' : editing.id} open level={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
    </Card>
  )
}
