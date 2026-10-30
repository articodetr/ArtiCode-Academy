// Detail / edit drawer of one user (MOD-03-T11): loads GET /api/users/:id and,
// for callers holding `users.update`, edits it with the smallest PATCH body.
// Contact identifiers and security timestamps appear only in the full
// projection (`users.read_contact`, D-R07). Later tasks add tabs here
// (invitation and reset links — T12; roles, status actions, guardians — T14).
import { EditOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Divider, Drawer, Flex, Form, List, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getUser, updateUser } from '../api/users'
import type { GuardianLink, UserDetail } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import type { Language } from '../i18n/language'
import { EmployeeProfileFields, IdentityFields, StudentProfileFields } from './UserFormFields'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from './users.format'
import type { Translate } from './users.format'
import { editFormValuesOf, planUserPatch } from './users.patch'
import type { EditUserFormValues } from './users.patch'

interface UserDrawerProps {
  /** The user to show; null keeps the drawer closed. */
  userId: string | null
  /** The row came from a list that includes deleted users (the server then needs `users.deactivate`). */
  includeDeleted?: boolean
  onClose: () => void
  /** Called with the detail returned by a successful PATCH so the list can refresh its row. */
  onUpdated: (user: UserDetail) => void
}

export function UserDrawer({ userId, includeDeleted = false, onClose, onUpdated }: UserDrawerProps) {
  const { t } = useTranslation()
  return (
    <Drawer open={userId !== null} onClose={onClose} title={t('users.detail.title')} width={600} destroyOnHidden>
      {userId ? (
        // Keyed so a different user (or projection) starts from a fresh body: no stale detail, no half-edited form.
        <UserDrawerBody key={`${userId}:${includeDeleted}`} userId={userId} includeDeleted={includeDeleted} onUpdated={onUpdated} />
      ) : null}
    </Drawer>
  )
}

interface UserDrawerBodyProps {
  userId: string
  includeDeleted: boolean
  onUpdated: (user: UserDetail) => void
}

function UserDrawerBody({ userId, includeDeleted, onUpdated }: UserDrawerBodyProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const contact = hasPermission('users.read_contact')
  const canUpdate = hasPermission('users.update')
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    const controller = new AbortController()
    getUser(userId, { includeDeleted, signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) setUser(detail)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error)
      })
    return () => controller.abort()
  }, [userId, includeDeleted])

  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('users.detail.loadFailed')}
        description={failureMessage(t, describeUsersFailure(loadError))}
      />
    )
  }
  if (!user) {
    return (
      <Flex justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flex>
    )
  }

  const onSave = async (values: EditUserFormValues) => {
    const patch = planUserPatch(user, values, { contact })
    if (!patch) {
      message.info(t('users.detail.nothingChanged'))
      setEditing(false)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateUser(user.id, patch)
      setUser(updated)
      onUpdated(updated)
      setEditing(false)
      message.success(t('users.detail.saved'))
    } catch (error) {
      const failure = describeUsersFailure(error)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setSaveError(text)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <UserHeader
        user={user}
        action={
          canUpdate && !user.deletedAt && !editing ? (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                setSaveError(null)
                setEditing(true)
              }}
            >
              {t('common.edit')}
            </Button>
          ) : null
        }
      />

      {!contact ? <Alert type="info" showIcon message={t('users.reducedHint')} style={{ marginTop: 16 }} /> : null}

      {editing ? (
        <Form<EditUserFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={editFormValuesOf(user)}
          onFinish={onSave}
          disabled={saving}
          style={{ marginTop: 16 }}
        >
          {saveError ? <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} /> : null}
          <IdentityFields contact={contact} mode="edit" />
          {user.studentProfile ? (
            <>
              <Divider plain>{t('users.detail.studentProfile')}</Divider>
              <StudentProfileFields withNotes={false} />
            </>
          ) : null}
          {user.employeeProfile ? (
            <>
              <Divider plain>{t('users.detail.employeeProfile')}</Divider>
              <EmployeeProfileFields />
            </>
          ) : null}
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              {t('common.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </Space>
        </Form>
      ) : (
        <UserDetails user={user} contact={contact} />
      )}
    </>
  )
}

function UserHeader({ user, action }: { user: UserDetail; action: ReactNode }) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  return (
    <Flex justify="space-between" align="flex-start" gap={12} wrap>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {displayNameOf(user)}
        </Typography.Title>
        {user.displayName ? <Typography.Text type="secondary">{user.fullName}</Typography.Text> : null}
        <div style={{ marginTop: 8 }}>
          <Space size={[4, 8]} wrap>
            <StatusTag value={user.status} />
            {user.deletedAt ? <Tag color="volcano">{t('users.deleted')}</Tag> : null}
            {user.roles.map((role) => (
              <Tag key={role.key} color="blue">
                {localizedLabel(role.label, language)}
              </Tag>
            ))}
          </Space>
        </div>
      </div>
      {action}
    </Flex>
  )
}

const EMPTY = '—'

function UserDetails({ user, contact }: { user: UserDetail; contact: boolean }) {
  const { t } = useTranslation()
  const { language } = useLocalized()

  const identity = [
    { key: 'fullName', label: t('users.fields.fullName'), children: user.fullName },
    { key: 'fullNameLatin', label: t('users.fields.fullNameLatin'), children: user.fullNameLatin ?? EMPTY },
    { key: 'displayName', label: t('users.fields.displayName'), children: user.displayName ?? EMPTY },
    ...(contact
      ? [
          { key: 'email', label: t('users.fields.email'), children: user.email ?? EMPTY },
          { key: 'username', label: t('users.fields.username'), children: user.username ?? EMPTY },
          { key: 'phone', label: t('users.fields.phone'), children: user.phone ?? EMPTY },
        ]
      : []),
    {
      key: 'locale',
      label: t('users.fields.locale'),
      children: user.locale ? t(`users.locales.${user.locale}`) : t('users.locales.academyDefault'),
    },
  ]

  const activity = [
    { key: 'createdAt', label: t('users.detail.createdAt'), children: formatDateTime(user.createdAt, language) },
    { key: 'updatedAt', label: t('users.detail.updatedAt'), children: formatDateTime(user.updatedAt, language) },
    ...(contact
      ? [
          { key: 'lastLoginAt', label: t('users.detail.lastLoginAt'), children: formatDateTime(user.lastLoginAt, language) },
          {
            key: 'emailVerifiedAt',
            label: t('users.detail.emailVerifiedAt'),
            children: user.emailVerifiedAt ? formatDateTime(user.emailVerifiedAt, language) : t('users.detail.notVerified'),
          },
          ...(user.lockedUntil
            ? [{ key: 'lockedUntil', label: t('users.detail.lockedUntil'), children: formatDateTime(user.lockedUntil, language) }]
            : []),
        ]
      : []),
    ...(user.deletedAt ? [{ key: 'deletedAt', label: t('users.detail.deletedAt'), children: formatDateTime(user.deletedAt, language) }] : []),
  ]

  return (
    <>
      <Divider plain>{t('users.detail.identity')}</Divider>
      <Descriptions column={1} size="small" items={identity} />

      <Divider plain>{user.employeeProfile ? t('users.detail.employeeProfile') : t('users.detail.studentProfile')}</Divider>
      <ProfileDetails user={user} t={t} language={language} />

      {user.guardians.length > 0 ? <LinkList title={t('users.detail.guardians')} links={user.guardians} /> : null}
      {user.students.length > 0 ? <LinkList title={t('users.detail.students')} links={user.students} /> : null}

      <Divider plain>{t('users.detail.activity')}</Divider>
      <Descriptions column={1} size="small" items={activity} />
    </>
  )
}

function ProfileDetails({ user, t, language }: { user: UserDetail; t: Translate; language: Language }) {
  if (user.studentProfile) {
    const profile = user.studentProfile
    return (
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: 'studentNumber', label: t('users.fields.studentNumber'), children: profile.studentNumber ?? EMPTY },
          { key: 'dateOfBirth', label: t('users.fields.dateOfBirth'), children: formatDay(profile.dateOfBirth, language) },
          { key: 'enrolledOn', label: t('users.fields.enrolledOn'), children: formatDay(profile.enrolledOn, language) },
        ]}
      />
    )
  }
  if (user.employeeProfile) {
    const profile = user.employeeProfile
    return (
      <Descriptions
        column={1}
        size="small"
        items={[
          { key: 'employeeNumber', label: t('users.fields.employeeNumber'), children: profile.employeeNumber ?? EMPTY },
          { key: 'kind', label: t('users.fields.employeeKind'), children: t(`users.kinds.${profile.kind}`) },
          { key: 'jobTitle', label: t('users.fields.jobTitle'), children: profile.jobTitle ?? EMPTY },
          { key: 'specialization', label: t('users.fields.specialization'), children: profile.specialization ?? EMPTY },
          { key: 'hiredOn', label: t('users.fields.hiredOn'), children: formatDay(profile.hiredOn, language) },
          { key: 'isActive', label: t('users.fields.isActive'), children: profile.isActive ? t('users.detail.yes') : t('users.detail.no') },
        ]}
      />
    )
  }
  return <Typography.Text type="secondary">{t('users.detail.noProfile')}</Typography.Text>
}

function LinkList({ title, links }: { title: string; links: GuardianLink[] }) {
  const { t } = useTranslation()
  return (
    <>
      <Divider plain>{title}</Divider>
      <List
        size="small"
        dataSource={links}
        renderItem={(link) => (
          <List.Item key={link.userId}>
            <Space wrap>
              <Typography.Text>{displayNameOf(link)}</Typography.Text>
              <Tag>{t(`users.relationships.${link.relationship}`)}</Tag>
              {link.isPrimary ? <Tag color="green">{t('users.detail.primary')}</Tag> : null}
            </Space>
          </List.Item>
        )}
      />
    </>
  )
}
