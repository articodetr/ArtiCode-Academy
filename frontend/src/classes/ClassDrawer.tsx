// Detail drawer of one class (J-F01): reads GET /api/classes/:id (API-051) and
// shows two tabs — details and teachers (ClassTeachersTab, API-056). For
// holders of `classes.manage`: an edit form (smallest PATCH — API-053) and an
// actions menu built from the mirrored state machine (classes.status.ts →
// API-054 with an optional reason, and API-055 for a planned class), each
// action confirmed in a modal. A teacher (`classes.read` alone) sees their
// class read-only. Enrollments (the roster) come with J-F04.
import { CheckCircleOutlined, DeleteOutlined, DownOutlined, EditOutlined, PlayCircleOutlined, StopOutlined, UndoOutlined, UnlockOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Drawer, Dropdown, Flex, Form, Input, Modal, Progress, Skeleton, Space, Tabs, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { changeClassStatus, deleteClass, getClass, updateClass } from '../api/classes'
import type { AcademyClass } from '../api/classes'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime, formatDay, localizedLabel } from '../users/users.format'
import { ClassFormFields } from './ClassFormFields'
import { ClassTeachersTab } from './ClassTeachersTab'
import { describeClassesFailure, failureMessage } from './classes.errors'
import { CLASS_STATUS_REASON_MAX_LENGTH, classFormValuesOf, planClassPatch } from './classes.form'
import type { ClassFormValues } from './classes.form'
import { availableClassActions, isDangerousClassAction, movesEnrollments } from './classes.status'
import type { ClassMenuAction } from './classes.status'

const ICONS: Readonly<Record<ClassMenuAction, ReactNode>> = {
  open: <UnlockOutlined />,
  start: <PlayCircleOutlined />,
  complete: <CheckCircleOutlined />,
  cancel: <StopOutlined />,
  restore: <UndoOutlined />,
  delete: <DeleteOutlined />,
}

const DASH = '—'

type DrawerTab = 'details' | 'teachers'

interface ClassDrawerProps {
  classId: string | null
  onClose: () => void
  /** The class the server returned after an edit, a status change or a teacher replacement. */
  onUpdated: (cls: AcademyClass) => void
  /** A planned class was deleted. */
  onDeleted: (classId: string) => void
}

/** Seats taken over capacity as a bar (shared with the list). */
export function SeatsBar({ cls }: { cls: Pick<AcademyClass, 'enrolledCount' | 'capacity'> }) {
  const percent = cls.capacity > 0 ? Math.round((cls.enrolledCount / cls.capacity) * 100) : 0
  return (
    <Progress
      percent={percent}
      size="small"
      status={cls.enrolledCount >= cls.capacity ? 'exception' : 'normal'}
      format={() => <span dir="ltr">{`${cls.enrolledCount} / ${cls.capacity}`}</span>}
      style={{ minWidth: 120, marginBottom: 0 }}
    />
  )
}

export function ClassDrawer({ classId, onClose, onUpdated, onDeleted }: ClassDrawerProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('classes.manage')
  const [cls, setCls] = useState<AcademyClass | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [tab, setTab] = useState<DrawerTab>('details')
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<ClassMenuAction | null>(null)

  useEffect(() => {
    if (!classId) return
    const controller = new AbortController()
    getClass(classId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return
        setCls(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(failureMessage(t, describeClassesFailure(error)))
      })
    return () => controller.abort()
  }, [classId, reloadTick, t])

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), [])

  const close = () => {
    setCls(null)
    setLoadError(null)
    setTab('details')
    setEditing(false)
    setPending(null)
    onClose()
  }

  const applyUpdate = (updated: AcademyClass) => {
    setCls(updated)
    onUpdated(updated)
  }

  const actions = cls && !editing ? availableClassActions(cls.status, cls.enrolledCount, canManage) : []
  const menu: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: t(`classes.actions.${action}`),
    icon: ICONS[action],
    danger: isDangerousClassAction(action),
  }))

  const name = cls ? localizedLabel(cls.name, language) : t('classes.drawer.title')
  const optional = (value: string | null | undefined) => (value === null || value === undefined || value === '' ? DASH : value)

  const details = cls ? (
    editing ? (
      <ClassEditForm
        // Remount per server version so the form starts from what the server holds (KI-049).
        key={`${cls.id}:${cls.updatedAt}`}
        cls={cls}
        onSaved={(updated) => {
          applyUpdate(updated)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    ) : (
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={t('classes.fields.code')}>
          <Typography.Text dir="ltr">{cls.code}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('common.status')}>
          <StatusTag value={cls.status} />
        </Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.nameAr')}>{cls.name.ar}</Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.nameEn')}>{optional(cls.name.en)}</Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.course')}>
          <Space wrap>
            <span>
              {localizedLabel(cls.course.name, language)} (<span dir="ltr">{cls.course.code}</span>)
            </span>
            {cls.course.status !== 'published' ? <StatusTag value={cls.course.status} /> : null}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.seats')}>
          <SeatsBar cls={cls} />
        </Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.startsOn')}>{formatDay(cls.startsOn, language)}</Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.endsOn')}>{formatDay(cls.endsOn, language)}</Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.notes')}>
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{optional(cls.notes)}</Typography.Paragraph>
        </Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.createdAt')}>{formatDateTime(cls.createdAt, language)}</Descriptions.Item>
        <Descriptions.Item label={t('classes.fields.updatedAt')}>{formatDateTime(cls.updatedAt, language)}</Descriptions.Item>
      </Descriptions>
    )
  ) : null

  return (
    <Drawer
      open={classId !== null}
      onClose={close}
      title={name}
      size="large"
      destroyOnHidden
      extra={
        canManage && cls && !editing ? (
          <Space>
            {tab === 'details' ? (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            ) : null}
            {menu.length > 0 ? (
              <Dropdown trigger={['click']} destroyOnHidden menu={{ items: menu, onClick: ({ key }) => setPending(key as ClassMenuAction) }}>
                <Button icon={<DownOutlined />} iconPlacement="end">
                  {t('classes.actions.menu')}
                </Button>
              </Dropdown>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message={loadError}
          action={
            <Button size="small" onClick={reload}>
              {t('classes.refresh')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!cls && !loadError ? <Skeleton active paragraph={{ rows: 8 }} data-testid="class-loading" /> : null}

      {cls ? (
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as DrawerTab)}
          items={[
            { key: 'details', label: t('classes.drawer.tabs.details'), children: details },
            {
              key: 'teachers',
              label: t('classes.drawer.tabs.teachers', { count: cls.teachers.length }),
              children: <ClassTeachersTab cls={cls} onUpdated={applyUpdate} />,
              disabled: editing,
            },
          ]}
        />
      ) : null}

      {cls && pending ? (
        <ClassActionModal
          // Mounted per action, so the reason never carries over to the next one.
          cls={cls}
          action={pending}
          onDone={(updated) => {
            setPending(null)
            if (updated) applyUpdate(updated)
            else {
              onDeleted(cls.id)
              close()
            }
          }}
          onStale={reload}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </Drawer>
  )
}

interface ClassActionModalProps {
  cls: AcademyClass
  action: ClassMenuAction
  /** The class after a status change, or null after a deletion. */
  onDone: (cls: AcademyClass | null) => void
  /** The class changed elsewhere meanwhile: re-read it. */
  onStale: () => void
  onCancel: () => void
}

function ClassActionModal({ cls, action, onDone, onStale, onCancel }: ClassActionModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = localizedLabel(cls.name, language)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'delete') {
        await deleteClass(cls.id)
        message.success(t('classes.done.delete'))
        onDone(null)
        return
      }
      const trimmed = reason.trim()
      const updated = await changeClassStatus(cls.id, trimmed ? { action, reason: trimmed } : { action })
      message.success(t(`classes.done.${action}`))
      onDone(updated)
    } catch (caught) {
      const failure = describeClassesFailure(caught)
      setError(failureMessage(t, failure))
      if (failure.key.endsWith('invalid_transition') || failure.key.endsWith('class_not_deletable')) onStale()
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={t('classes.confirm.title', { action: t(`classes.actions.${action}`), name })}
      okText={t(`classes.actions.${action}`)}
      okButtonProps={{ danger: isDangerousClassAction(action) }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void confirm()}
      onCancel={() => {
        if (!busy) onCancel()
      }}
    >
      <Typography.Paragraph>{t(`classes.confirm.${action}`)}</Typography.Paragraph>
      {movesEnrollments(action) && cls.enrolledCount > 0 ? (
        <Alert type="warning" showIcon message={t(`classes.confirm.enrollments.${action}`, { count: cls.enrolledCount })} style={{ marginBottom: 12 }} />
      ) : null}
      {action !== 'delete' ? (
        <Form layout="vertical">
          <Form.Item label={t('classes.confirm.reason')} extra={t('classes.confirm.reasonHint')} htmlFor="class-status-reason">
            <Input.TextArea
              id="class-status-reason"
              rows={2}
              maxLength={CLASS_STATUS_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </Form.Item>
        </Form>
      ) : null}
      {error ? <Alert type="error" showIcon message={error} /> : null}
    </Modal>
  )
}

interface ClassEditFormProps {
  cls: AcademyClass
  onSaved: (cls: AcademyClass) => void
  onCancel: () => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the class as the server holds it (a form instance kept across sessions
 * merges the values of a cancelled session — KI-049).
 */
function ClassEditForm({ cls, onSaved, onCancel }: ClassEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  const save = async (values: ClassFormValues) => {
    const body = planClassPatch(cls, values)
    if (!body) {
      message.info(t('classes.drawer.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    try {
      const updated = await updateClass(cls.id, body)
      message.success(t('classes.drawer.saved'))
      onSaved(updated)
    } catch (caught) {
      const failure = describeClassesFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else message.error(text)
      setSaving(false)
    }
  }

  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={classFormValuesOf(cls)}
      onFinish={(values) => void save(values as ClassFormValues)}
      disabled={saving}
    >
      <ClassFormFields form={form} mode="edit" enrolledCount={cls.enrolledCount} />
      <Flex gap={8} justify="flex-end">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="primary" htmlType="submit" loading={saving}>
          {t('common.save')}
        </Button>
      </Flex>
    </Form>
  )
}
