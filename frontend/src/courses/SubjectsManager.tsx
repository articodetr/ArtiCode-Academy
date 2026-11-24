// The «المواد» (school subjects) tab of the courses page (PORTAL-04), for holders of `courses.manage` — a mirror of
// LevelsManager: the ordered table (GET /api/subjects, the manager view with course counts), create/edit through
// SubjectModal, up/down arrows that send the whole new order (PUT /api/subjects/order), and delete — refused for a
// subject in use: the button is disabled with the reason, and a stale count still gets the server's `subject_in_use`
// message. Rows come from server answers only.
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Flex, Popconfirm, Space, Table, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteSubject, reorderSubjects } from '../api/subjects'
import type { Subject } from '../api/subjects'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeCoursesFailure, failureMessage } from './courses.errors'
import { SubjectModal } from './SubjectModal'
import { moveSubject } from './subjects.form'
import type { SubjectsState } from './useSubjects'

interface SubjectsManagerProps {
  state: SubjectsState
  /** Called after every successful write (the course drawer shows subject names). */
  onChanged?: () => void
}

export function SubjectsManager({ state, onChanged }: SubjectsManagerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { subjects, loading, error, reload, setSubjects } = state
  const [editing, setEditing] = useState<Subject | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const fail = (caught: unknown) => {
    message.error(failureMessage(t, describeCoursesFailure(caught)))
    // A stale list (a subject gone or in use, an order changed elsewhere): show the server's.
    reload()
  }

  const move = async (index: number, delta: -1 | 1) => {
    const order = moveSubject(subjects, index, delta)
    if (!order) return
    setBusy(true)
    try {
      setSubjects((await reorderSubjects(order)).items)
      message.success(t('courses.subjects.reordered'))
      onChanged?.()
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (subject: Subject) => {
    setBusy(true)
    try {
      await deleteSubject(subject.id)
      setSubjects(subjects.filter((item) => item.id !== subject.id))
      message.success(t('courses.subjects.deleted'))
      onChanged?.()
    } catch (caught) {
      fail(caught)
    } finally {
      setBusy(false)
    }
  }

  const saved = (subject: Subject, created: boolean) => {
    setEditing(null)
    setSubjects(created ? [...subjects, subject] : subjects.map((item) => (item.id === subject.id ? subject : item)))
    message.success(created ? t('courses.subjects.created', { name: localizedLabel(subject.name, language) }) : t('courses.subjects.saved'))
    onChanged?.()
  }

  const columns: TableProps<Subject>['columns'] = [
    { title: t('courses.subjects.columns.order'), key: 'order', width: 56, render: (_, _row, index) => index + 1 },
    {
      title: t('courses.subjects.columns.code'),
      key: 'code',
      render: (_, row) => (
        <Typography.Text strong>
          <bdi dir="ltr">{row.code}</bdi>
        </Typography.Text>
      ),
    },
    { title: t('courses.subjects.columns.name'), key: 'name', render: (_, row) => localizedLabel(row.name, language) },
    { title: t('courses.subjects.columns.status'), key: 'status', render: (_, row) => <StatusTag value={row.isActive ? 'active' : 'inactive'} /> },
    { title: t('courses.subjects.columns.courseCount'), key: 'courseCount', render: (_, row) => row.courseCount ?? '—' },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_, row, index) => {
        const inUse = (row.courseCount ?? 0) > 0
        const deleteLabel = `${t('courses.subjects.delete')}: ${row.code}`
        return (
          <Space size={4} wrap>
            <Button
              size="small"
              icon={<ArrowUpOutlined />}
              aria-label={`${t('courses.subjects.moveUp')}: ${row.code}`}
              disabled={busy || index === 0}
              onClick={() => void move(index, -1)}
            />
            <Button
              size="small"
              icon={<ArrowDownOutlined />}
              aria-label={`${t('courses.subjects.moveDown')}: ${row.code}`}
              disabled={busy || index === subjects.length - 1}
              onClick={() => void move(index, 1)}
            />
            <Button size="small" icon={<EditOutlined />} aria-label={`${t('common.edit')}: ${row.code}`} disabled={busy} onClick={() => setEditing(row)} />
            {inUse ? (
              // A number, so i18next picks the plural form: «تستخدمها دورة واحدة».
              <Tooltip title={t('courses.errors.subject_in_use', { count: row.courseCount ?? 0 })}>
                <span>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={deleteLabel} disabled />
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('courses.subjects.deleteConfirm', { name: localizedLabel(row.name, language) })}
                okText={t('courses.subjects.delete')}
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
        <Typography.Text type="secondary">{t('courses.subjects.hint')}</Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload} aria-label={t('courses.refresh')} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('courses.subjects.add')}
          </Button>
        </Space>
      </Flex>

      {error ? <Alert type="error" showIcon message={failureMessage(t, describeCoursesFailure(error))} style={{ marginBottom: 16 }} /> : null}

      <Table<Subject>
        rowKey="id"
        columns={columns}
        dataSource={subjects}
        loading={loading || busy}
        pagination={false}
        // On a phone the table scrolls inside its own box instead of widening the page (KI-095).
        scroll={{ x: true }}
        locale={{ emptyText: t('courses.subjects.empty') }}
      />

      {/* Mounted per session: its form starts from the chosen subject, never from the values of an earlier session. */}
      {editing !== null ? (
        <SubjectModal key={editing === 'new' ? 'new' : editing.id} open subject={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />
      ) : null}
    </Card>
  )
}
