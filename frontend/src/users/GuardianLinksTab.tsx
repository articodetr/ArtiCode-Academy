// Guardians / students tab of the user drawer (MOD-03-T14) on the T09
// contracts: the list of GET /api/users/:studentId/guardians (API-029) or
// GET /api/users/:guardianId/students (API-030), and for holders of
// `guardians.link` the link form (POST, API-031), the relationship select and
// "make primary" (PATCH, API-032) and the unlink confirmation (DELETE, API-033).
// Every write addresses the student's path; the same person is refused locally
// before any request (AC3). The list is re-read from the server after a write —
// the primary-first order is the server's.
import { UserAddOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Flex, Form, List, Popconfirm, Select, Space, Spin, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { linkGuardian, listGuardians, listStudents, unlinkGuardian, updateGuardianLink } from '../api/guardians'
import type { GuardianLinkItem } from '../api/guardians'
import { GUARDIAN_RELATIONSHIPS, listUsers } from '../api/users'
import type { GuardianRelationship, UserDetail, UserListItem } from '../api/users'
import { useAuth } from '../auth/auth-context'
import { useLocalized } from '../i18n/useLocalized'
import { describeUsersFailure, failureMessage } from './users.errors'
import { displayNameOf, formatDateTime } from './users.format'
import { buildLinkInput, counterpartRole, linkRefusal, partiesOf, planLinkUpdate } from './users.guardians'
import type { LinkFormValues, LinkSide } from './users.guardians'

interface GuardianLinksTabProps {
  user: UserDetail
  side: LinkSide
}

export function GuardianLinksTab({ user, side }: GuardianLinksTabProps) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const contact = hasPermission('users.read_contact')
  const canLink = hasPermission('guardians.link') && !user.deletedAt
  const [items, setItems] = useState<GuardianLinkItem[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const request = side === 'guardians' ? listGuardians(user.id, controller.signal) : listStudents(user.id, controller.signal)
    request
      .then((list) => {
        if (!controller.signal.aborted) setItems(list.items)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error)
      })
    return () => controller.abort()
  }, [user.id, side, version])

  const reload = () => setVersion((value) => value + 1)

  const run = async (otherId: string, task: () => Promise<unknown>, doneKey: string) => {
    setBusyId(otherId)
    setActionError(null)
    try {
      await task()
      message.success(t(doneKey))
      reload()
    } catch (error) {
      const failure = describeUsersFailure(error)
      setActionError(failureMessage(t, failure))
      // The link or a party vanished elsewhere: show what the server has now.
      if (failure.key.endsWith('not_linked') || failure.key.endsWith('_not_found')) reload()
    } finally {
      setBusyId(null)
    }
  }

  const setPrimary = (item: GuardianLinkItem) => {
    const { studentId, guardianId } = partiesOf(side, user.id, item.user.id)
    return run(item.user.id, () => updateGuardianLink(studentId, guardianId, { isPrimary: true }), 'users.links.updated')
  }

  const changeRelationship = (item: GuardianLinkItem, relationship: GuardianRelationship) => {
    const plan = planLinkUpdate(item, { relationship })
    if (!plan) return
    const { studentId, guardianId } = partiesOf(side, user.id, item.user.id)
    void run(item.user.id, () => updateGuardianLink(studentId, guardianId, plan), 'users.links.updated')
  }

  const unlink = (item: GuardianLinkItem) => {
    const { studentId, guardianId } = partiesOf(side, user.id, item.user.id)
    return run(item.user.id, () => unlinkGuardian(studentId, guardianId), 'users.links.unlinked')
  }

  if (loadError) {
    return <Alert type="error" showIcon message={t('users.links.loadFailed')} description={failureMessage(t, describeUsersFailure(loadError))} />
  }
  if (!items) {
    return (
      <Flex justify="center" style={{ padding: 32 }}>
        <Spin />
      </Flex>
    )
  }

  const relationshipOptions = GUARDIAN_RELATIONSHIPS.map((value) => ({ value, label: t(`users.relationships.${value}`) }))

  return (
    <>
      {actionError ? (
        <Alert type="error" showIcon closable message={actionError} onClose={() => setActionError(null)} style={{ marginBottom: 16 }} />
      ) : null}

      {canLink && !adding ? (
        <Button icon={<UserAddOutlined />} onClick={() => setAdding(true)} style={{ marginBottom: 16 }}>
          {t(`users.links.add.${side}`)}
        </Button>
      ) : null}

      {canLink && adding ? (
        <LinkForm
          user={user}
          side={side}
          linkedIds={items.map((item) => item.user.id)}
          onCancel={() => setAdding(false)}
          onLinked={() => {
            setAdding(false)
            message.success(t('users.links.linked'))
            reload()
          }}
        />
      ) : null}

      <List<GuardianLinkItem>
        size="small"
        dataSource={items}
        locale={{ emptyText: t(`users.links.empty.${side}`) }}
        renderItem={(item) => {
          const busy = busyId === item.user.id
          const name = displayNameOf(item.user)
          const identifier = contact ? (item.user.email ?? item.user.username) : null
          return (
            <List.Item
              key={item.user.id}
              actions={
                canLink
                  ? [
                      ...(!item.isPrimary
                        ? [
                            <Button key="primary" type="link" size="small" loading={busy} onClick={() => void setPrimary(item)}>
                              {t('users.links.setPrimary')}
                            </Button>,
                          ]
                        : []),
                      <Popconfirm
                        key="unlink"
                        title={t('users.links.unlinkConfirm', { name })}
                        okText={t('users.links.unlink')}
                        cancelText={t('common.cancel')}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void unlink(item)}
                      >
                        <Button type="link" size="small" danger loading={busy}>
                          {t('users.links.unlink')}
                        </Button>
                      </Popconfirm>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                title={
                  <Space wrap>
                    <Typography.Text>{name}</Typography.Text>
                    {item.isPrimary ? <Tag color="green">{t('users.detail.primary')}</Tag> : null}
                    {canLink ? (
                      <Select<GuardianRelationship>
                        size="small"
                        value={item.relationship}
                        aria-label={`${t('users.links.relationship')}: ${name}`}
                        options={relationshipOptions}
                        disabled={busy}
                        onChange={(value) => changeRelationship(item, value)}
                        popupMatchSelectWidth={false}
                      />
                    ) : (
                      <Tag>{t(`users.relationships.${item.relationship}`)}</Tag>
                    )}
                  </Space>
                }
                description={
                  <Space wrap size={[12, 4]}>
                    {identifier ? (
                      <Typography.Text type="secondary" dir="ltr">
                        {identifier}
                      </Typography.Text>
                    ) : null}
                    <Typography.Text type="secondary">
                      {t('users.links.linkedAt')} {formatDateTime(item.createdAt, language)}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )
        }}
      />
    </>
  )
}

interface LinkFormProps {
  user: UserDetail
  side: LinkSide
  /** Ids already linked on this side — offered disabled, never posted again. */
  linkedIds: string[]
  onCancel: () => void
  onLinked: () => void
}

const SEARCH_MIN_LENGTH = 2
const SEARCH_DELAY_MS = 250
const SEARCH_LIMIT = 10

function LinkForm({ user, side, linkedIds, onCancel, onLinked }: LinkFormProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<LinkFormValues>()
  const [candidates, setCandidates] = useState<UserListItem[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  // Remote search of API-012 restricted to the counterpart role, debounced; stale answers are dropped.
  const search = (text: string) => {
    setQuery(text)
    if (timer.current) clearTimeout(timer.current)
    const q = text.trim()
    if (q.length < SEARCH_MIN_LENGTH) {
      setCandidates([])
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(() => {
      const id = ++requestId.current
      listUsers({ q, role: counterpartRole(side), limit: SEARCH_LIMIT })
        .then((list) => {
          if (id === requestId.current) setCandidates(list.items)
        })
        .catch(() => {
          if (id === requestId.current) setCandidates([])
        })
        .finally(() => {
          if (id === requestId.current) setSearching(false)
        })
    }, SEARCH_DELAY_MS)
  }

  const refusalText = (refusal: ReturnType<typeof linkRefusal>) =>
    refusal === 'same_person' ? t('users.links.samePerson') : refusal === 'already_linked' ? t('users.links.alreadyLinked') : undefined

  const onFinish = async (values: LinkFormValues) => {
    // AC3: nobody is linked to themself — refused here, before any request.
    const refusal = linkRefusal(user.id, values.otherId, linkedIds)
    if (refusal) {
      form.setFields([{ name: 'otherId', errors: [refusalText(refusal) ?? ''] }])
      return
    }
    const { studentId } = partiesOf(side, user.id, values.otherId ?? '')
    setSubmitting(true)
    setError(null)
    try {
      await linkGuardian(studentId, buildLinkInput(side, user.id, values))
      onLinked()
    } catch (caught) {
      setError(failureMessage(t, describeUsersFailure(caught)))
    } finally {
      setSubmitting(false)
    }
  }

  const notFound = searching ? (
    <Spin size="small" />
  ) : (
    <Typography.Text type="secondary">{query.trim().length < SEARCH_MIN_LENGTH ? t('users.links.searchHint') : t('users.links.noMatches')}</Typography.Text>
  )

  return (
    <Card size="small" title={t(`users.links.add.${side}`)} style={{ marginBottom: 16 }}>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Form<LinkFormValues> form={form} layout="vertical" requiredMark={false} onFinish={onFinish} disabled={submitting}>
        <Form.Item
          name="otherId"
          label={t(`users.links.party.${side}`)}
          rules={[
            { required: true, message: t('users.links.required') },
            {
              validator: (_rule, value: unknown) => {
                const refusal = linkRefusal(user.id, typeof value === 'string' ? value : undefined, linkedIds)
                return refusal ? Promise.reject(new Error(refusalText(refusal))) : Promise.resolve()
              },
            },
          ]}
        >
          <Select<string>
            showSearch
            filterOption={false}
            onSearch={search}
            loading={searching}
            placeholder={t('users.links.searchPlaceholder')}
            notFoundContent={notFound}
            options={candidates.map((candidate) => {
              const refusal = linkRefusal(user.id, candidate.id, linkedIds)
              return { value: candidate.id, label: displayNameOf(candidate), disabled: refusal !== null, title: refusalText(refusal) }
            })}
          />
        </Form.Item>
        <Form.Item name="relationship" label={t('users.links.relationship')} rules={[{ required: true, message: t('users.links.required') }]}>
          <Select<GuardianRelationship> options={GUARDIAN_RELATIONSHIPS.map((value) => ({ value, label: t(`users.relationships.${value}`) }))} />
        </Form.Item>
        <Form.Item name="isPrimary" valuePropName="checked">
          <Checkbox>{t('users.links.isPrimary')}</Checkbox>
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {t('users.links.submit')}
          </Button>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </Space>
      </Form>
    </Card>
  )
}
