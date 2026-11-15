// Detail / edit drawer of one user (MOD-03-T11): loads GET /api/users/:id and,
// for callers holding `users.update`, edits it with the smallest PATCH body.
// Contact identifiers and security timestamps appear only in the full
// projection (`users.read_contact`, D-R07). Since MOD-03-T12 the header also
// issues the one-time invitation link (`invited` accounts, `users.create`) and
// the password-reset link (`active` accounts, `users.update`) — API-015/API-019,
// shown once in IssuedLinkModal. Since MOD-03-T14 the header carries the
// account-actions menu (API-027/API-028) and the body is tabbed: details,
// roles (`users.roles.assign`, API-034) and guardians / students (API-029..033).
// Since J-F23 (KI-054, the rule of the class drawer's KI-052 after J-F21):
// while an editor holds unsaved work — a change in the edit form, a roles
// selection that differs from the held roles, a party picked in a link form —
// Escape and a mask click no longer close the drawer, and the close button asks
// first; an editor opened without a change, or changed back, holds nothing.
// The account-actions modal sits on top and takes Escape itself (its Cancel).
// The roles the users page already read reach the roles tab (PR #62, note 1).
// Since J-F27 the same unsaved work also holds a browser back/forward, which
// asks the same question (NavigationBlocker), and a reload or a tab close gets
// the browser's own prompt (useUnsavedChangesGuard — KI-055).
import { EditOutlined, KeyOutlined, LinkOutlined } from '@ant-design/icons'
import { Alert, App, Button, Descriptions, Divider, Drawer, Flex, Form, Popconfirm, Space, Spin, Tabs, Tag, Typography } from 'antd'
import type { TabsProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IssuedLinkModal } from '../account/IssuedLinkModal'
import type { IssuedLinkKind } from '../account/IssuedLinkModal'
import { issueInvitation, issuePasswordReset } from '../api/account'
import type { IssuedLink } from '../api/account'
import type { Role } from '../api/roles'
import { getUser, updateUser } from '../api/users'
import type { UserDetail } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { StatusTag } from '../components/StatusTag'
import { useLocalized } from '../i18n/useLocalized'
import type { Language } from '../i18n/language'
import { GuardianLinksTab } from './GuardianLinksTab'
import { EmployeeProfileFields, IdentityFields, StudentProfileFields } from './UserFormFields'
import { UserRolesTab } from './UserRolesTab'
import { UserStatusActions } from './UserStatusActions'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf, formatDateTime, formatDay, localizedLabel } from './users.format'
import type { Translate } from './users.format'
import { linkSidesOf } from './users.guardians'
import type { LinkSide } from './users.guardians'
import { editFormValuesOf, planUserPatch, userFormHasChanges } from './users.patch'
import type { EditUserFormValues } from './users.patch'

interface UserDrawerProps {
  /** The user to show; null keeps the drawer closed. */
  userId: string | null
  /** The row came from a list that includes deleted users (the server then needs `users.deactivate`). */
  includeDeleted?: boolean
  /** The roles of API-022 the page already read (J-F23): the roles tab uses them instead of a second read. */
  loadedRoles?: readonly Role[] | null
  onClose: () => void
  /** Called with the detail returned by a successful write so the list can refresh its row. */
  onUpdated: (user: UserDetail) => void
}

/** The editors of the drawer that report unsaved work (KI-054): the edit form and one per tab. */
type EditorPart = 'details' | 'roles' | LinkSide

type UnsavedReporters = Readonly<Record<EditorPart, (unsaved: boolean) => void>>

const NOTHING_UNSAVED: Readonly<Record<EditorPart, boolean>> = { details: false, roles: false, guardians: false, students: false }

export function UserDrawer({ userId, includeDeleted = false, loadedRoles = null, onClose, onUpdated }: UserDrawerProps) {
  const { t } = useTranslation()
  const [unsavedParts, setUnsavedParts] = useState<Readonly<Record<EditorPart, boolean>>>(NOTHING_UNSAVED)

  // One stable reporter per editor (the editors report from an effect that depends on it).
  const reportUnsaved = useMemo<UnsavedReporters>(() => {
    const reporter = (part: EditorPart) => (unsaved: boolean) => setUnsavedParts((current) => (current[part] === unsaved ? current : { ...current, [part]: unsaved }))
    return { details: reporter('details'), roles: reporter('roles'), guardians: reporter('guardians'), students: reporter('students') }
  }, [])
  // KI-054: while an editor holds unsaved work, Escape and a mask click must not drop it with the drawer.
  const unsaved = unsavedParts.details || unsavedParts.roles || unsavedParts.guardians || unsavedParts.students

  const close = () => {
    setUnsavedParts(NOTHING_UNSAVED)
    onClose()
  }

  // The close button (Escape and the mask too when nothing is unsaved) asks first while an editor
  // holds unsaved work, and so does a browser back/forward (NavigationBlocker below) — one question
  // (common.unsaved.*); a reload or a tab close gets the browser's own prompt (KI-055).
  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close)

  return (
    <Drawer
      open={userId !== null}
      onClose={requestClose}
      // KI-054: unsaved work turns off the Escape key and the mask click; a modal, Select or
      // Dropdown open on top still closes on Escape (it sits above the drawer).
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      title={t('users.detail.title')}
      width={600}
      destroyOnHidden
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {userId ? (
        // Keyed so a different user (or projection) starts from a fresh body: no stale detail, no half-edited form.
        <UserDrawerBody
          key={`${userId}:${includeDeleted}`}
          userId={userId}
          includeDeleted={includeDeleted}
          loadedRoles={loadedRoles}
          reportUnsaved={reportUnsaved}
          onUpdated={onUpdated}
        />
      ) : null}
    </Drawer>
  )
}

interface UserDrawerBodyProps {
  userId: string
  includeDeleted: boolean
  loadedRoles: readonly Role[] | null
  reportUnsaved: UnsavedReporters
  onUpdated: (user: UserDetail) => void
}

const DETAILS_TAB = 'details'
const ROLES_TAB = 'roles'

function UserDrawerBody({ userId, includeDeleted, loadedRoles, reportUnsaved, onUpdated }: UserDrawerBodyProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  const contact = hasPermission('users.read_contact')
  const canUpdate = hasPermission('users.update')
  const canCreate = hasPermission('users.create')
  const canAssignRoles = hasPermission('users.roles.assign')
  const [user, setUser] = useState<UserDetail | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [issuing, setIssuing] = useState<IssuedLinkKind | null>(null)
  const [issued, setIssued] = useState<{ kind: IssuedLinkKind; link: IssuedLink } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tab, setTab] = useState(DETAILS_TAB)

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
  }, [userId, includeDeleted, reloadKey])

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

  /** Every write answers with the detail in the caller's projection: show it and hand it to the list. */
  const applyUpdate = (updated: UserDetail) => {
    setUser(updated)
    onUpdated(updated)
  }

  const reloadDetail = () => setReloadKey((value) => value + 1)

  // One-time links (T12): the server returns the raw token exactly once; the
  // modal shows it, nothing else keeps it.
  const issue = async (kind: IssuedLinkKind) => {
    setIssuing(kind)
    setActionError(null)
    try {
      const link = await (kind === 'invitation' ? issueInvitation(user.id) : issuePasswordReset(user.id))
      setIssued({ kind, link })
      message.success(t(`account.issued.${kind}.done`))
    } catch (error) {
      setActionError(failureMessage(t, describeUsersFailure(error)))
    } finally {
      setIssuing(null)
    }
  }

  const canInvite = canCreate && user.status === 'invited' && !user.deletedAt
  const canReset = canUpdate && user.status === 'active' && !user.deletedAt

  const details = editing ? (
    <UserEditForm
      user={user}
      contact={contact}
      onSaved={(updated) => {
        applyUpdate(updated)
        setEditing(false)
      }}
      onCancel={() => setEditing(false)}
      onUnsavedChange={reportUnsaved.details}
    />
  ) : (
    <UserDetails user={user} contact={contact} />
  )

  const tabs: TabsProps['items'] = [
    { key: DETAILS_TAB, label: t('users.tabs.details'), children: details },
    ...(canAssignRoles
      ? [
          {
            key: ROLES_TAB,
            label: t('users.tabs.roles'),
            children: <UserRolesTab user={user} onSaved={applyUpdate} loadedRoles={loadedRoles} onUnsavedChange={reportUnsaved.roles} />,
          },
        ]
      : []),
    ...linkSidesOf(user).map((side) => ({
      key: side,
      label: t(`users.tabs.${side}`),
      children: <GuardianLinksTab user={user} side={side} onUnsavedChange={reportUnsaved[side]} />,
    })),
  ]
  // A tab can disappear after a write (the student role removed, …): fall back to the details.
  const activeKey = tabs.some((item) => item.key === tab) ? tab : DETAILS_TAB

  return (
    <>
      <UserHeader
        user={user}
        action={
          !editing ? (
            <Space wrap>
              {canUpdate && !user.deletedAt ? (
                <Button
                  icon={<EditOutlined />}
                  onClick={() => {
                    setTab(DETAILS_TAB)
                    setEditing(true)
                  }}
                >
                  {t('common.edit')}
                </Button>
              ) : null}
              {canInvite ? (
                <Button icon={<LinkOutlined />} loading={issuing === 'invitation'} onClick={() => void issue('invitation')}>
                  {t('account.issued.invitation.button')}
                </Button>
              ) : null}
              {canReset ? (
                <Popconfirm
                  title={t('account.issued.reset.confirm')}
                  okText={t('account.issued.reset.button')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => void issue('reset')}
                >
                  <Button icon={<KeyOutlined />} loading={issuing === 'reset'}>
                    {t('account.issued.reset.button')}
                  </Button>
                </Popconfirm>
              ) : null}
              <UserStatusActions user={user} onChanged={applyUpdate} onStale={reloadDetail} />
            </Space>
          ) : null
        }
      />

      {actionError ? (
        <Alert type="error" showIcon closable message={actionError} onClose={() => setActionError(null)} style={{ marginTop: 16 }} />
      ) : null}

      {!contact ? <Alert type="info" showIcon message={t('users.reducedHint')} style={{ marginTop: 16 }} /> : null}

      <Tabs activeKey={activeKey} onChange={setTab} items={tabs} style={{ marginTop: 8 }} />

      <IssuedLinkModal kind={issued?.kind ?? 'invitation'} issued={issued?.link ?? null} onClose={() => setIssued(null)} />
    </>
  )
}

interface UserEditFormProps {
  user: UserDetail
  contact: boolean
  /** Called with the detail returned by a successful PATCH. */
  onSaved: (user: UserDetail) => void
  onCancel: () => void
  /** Whether a field holds a change (KI-054): reported on every edit, false once the form is left. */
  onUnsavedChange: (unsaved: boolean) => void
}

/**
 * The edit form of one edit session. It owns its form so every session starts
 * from the user as the server holds it: a form instance kept across sessions
 * would merge the values typed in a cancelled session over the new initial
 * values, and saving would send them (rc-field-form keeps unmounted values — KI-049).
 */
function UserEditForm({ user, contact, onSaved, onCancel, onUnsavedChange }: UserEditFormProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])

  const onSave = async (values: EditUserFormValues) => {
    const patch = planUserPatch(user, values, { contact })
    if (!patch) {
      message.info(t('users.detail.nothingChanged'))
      onCancel()
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateUser(user.id, patch)
      message.success(t('users.detail.saved'))
      onSaved(updated)
    } catch (error) {
      const failure = describeUsersFailure(error)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setSaveError(text)
      setSaving(false)
    }
  }

  return (
    <Form<EditUserFormValues>
      form={form}
      layout="vertical"
      requiredMark={false}
      initialValues={editFormValuesOf(user)}
      // A change changed back holds nothing (KI-054 — the J-F21 rule): compared with the stored user.
      onValuesChange={(_changed, values) => onUnsavedChange(userFormHasChanges(user, values, { contact }))}
      onFinish={(values) => void onSave(values)}
      disabled={saving}
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
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </Space>
    </Form>
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
