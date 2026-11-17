// Audit log (MOD-03-T15): a read-only table of GET /api/audit-logs (API-011)
// for holders of `audit.read` — the server's filters (event prefix, actor,
// entity, before) and its keyset pagination as «previous / next». Nothing is
// written; the server remains the security boundary.
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, AutoComplete, Button, Card, Flex, Form, Input, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditLogItem } from '../api/audit'
import { describeAuditFailure, failureMessage } from '../audit/audit.errors'
import { familyColor, metadataSummary, metadataText, shortId } from '../audit/audit.format'
import { AUDIT_ACTION_SUGGESTIONS, AUDIT_PAGE_SIZES, EMPTY_FILTER_VALUES, validateAuditFilters } from '../audit/audit.query'
import type { AuditFilterValues, AuditFilters } from '../audit/audit.query'
import { useAuditLog } from '../audit/useAuditLog'
import { useUserNames } from '../audit/useUserNames'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import './AuditLogPage.css'

const FILTER_FIELDS = Object.keys(EMPTY_FILTER_VALUES) as (keyof AuditFilterValues)[]
const ACTION_OPTIONS = AUDIT_ACTION_SUGGESTIONS.map((value) => ({ value }))

const EMPTY = '—'

export function AuditLogPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { user, hasPermission } = useAuth()
  const log = useAuditLog()
  const [form] = Form.useForm<AuditFilterValues>()

  /** Applies the form: a value the server would reject stays on the field and sends nothing. */
  const apply = (values: AuditFilterValues) => {
    const problems = validateAuditFilters(values)
    form.setFields(FILTER_FIELDS.map((name) => ({ name, errors: problems[name] ? [t(problems[name])] : [] })))
    if (Object.keys(problems).length > 0) return
    log.setFilters(values)
  }

  const reset = () => {
    form.resetFields()
    log.setFilters(EMPTY_FILTER_VALUES)
  }

  /** A click on an actor or an entity in the table narrows the list to it. */
  const filterBy = (patch: Partial<AuditFilterValues>) => {
    const values = { ...form.getFieldsValue(), ...patch }
    form.setFieldsValue(patch)
    apply(values)
  }

  // The event field takes a literal prefix (KI-092). While its suggestions are open, rc-select
  // highlights the first one that starts with the typed text and takes it on Enter (it then prevents
  // the default, so the form is not submitted). Unless an arrow key chose that suggestion, put the
  // typed text back — the input still shows it, React has not re-rendered within this event — and
  // apply it, as the apply button does. A click or arrow keys + Enter still pick a suggestion.
  const pickedByArrow = useRef(false)
  const keepTypedPrefixOnEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') pickedByArrow.current = true
    else if (event.key === 'Enter' && event.defaultPrevented && !pickedByArrow.current && event.target instanceof HTMLInputElement) {
      filterBy({ action: event.target.value })
    }
  }

  // Names instead of ids where the caller may read users (redesign): the id stays in the title and the filter.
  const names = useUserNames(
    log.items.flatMap((row) => [row.actorUserId, row.entityType === 'users' ? row.entityId : null].filter((id): id is string => Boolean(id))),
    hasPermission('users.read'),
  )
  const idLabel = (id: string) => {
    const name = names.get(id)
    return name ? (
      <Typography.Text>{name}</Typography.Text>
    ) : (
      <Typography.Text code>
        <bdi dir="ltr">{shortId(id)}</bdi>
      </Typography.Text>
    )
  }

  const actorCell = (row: AuditLogItem) => {
    if (!row.actorUserId) return <Typography.Text type="secondary">{t('audit.system')}</Typography.Text>
    const id = row.actorUserId
    return (
      <Button
        type="link"
        size="small"
        title={id}
        aria-label={`${t('audit.filterByActor')}: ${id}`}
        onClick={() => filterBy({ actorUserId: id })}
        style={{ paddingInline: 0 }}
      >
        {id === user?.id ? <Tag color="green">{t('audit.you')}</Tag> : null}
        {idLabel(id)}
      </Button>
    )
  }

  const entityCell = (row: AuditLogItem) => {
    if (!row.entityType) return EMPTY
    const { entityType, entityId } = row
    return (
      <Space size={4}>
        <Typography.Text>
          <bdi dir="ltr">{entityType}</bdi>
        </Typography.Text>
        {entityId ? (
          <Button
            type="link"
            size="small"
            title={entityId}
            aria-label={`${t('audit.filterByEntity')}: ${entityType} ${entityId}`}
            onClick={() => filterBy({ entityType, entityId })}
            style={{ paddingInline: 0 }}
          >
            {entityType === 'users' ? idLabel(entityId) : (
              <Typography.Text code>
                <bdi dir="ltr">{shortId(entityId)}</bdi>
              </Typography.Text>
            )}
          </Button>
        ) : null}
      </Space>
    )
  }

  const columns: TableProps<AuditLogItem>['columns'] = [
    {
      title: t('audit.columns.time'),
      key: 'time',
      render: (_, row) => <Typography.Text style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt, language)}</Typography.Text>,
    },
    {
      title: t('audit.columns.action'),
      key: 'action',
      render: (_, row) => {
        const summary = metadataSummary(row.metadata)
        return (
          <Space orientation="vertical" size={0}>
            <Tag color={familyColor(row.action)} style={{ fontFamily: 'monospace', marginInlineEnd: 0 }}>
              <bdi dir="ltr">{row.action}</bdi>
            </Tag>
            {summary ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <bdi dir="ltr">{summary}</bdi>
              </Typography.Text>
            ) : null}
          </Space>
        )
      },
    },
    { title: t('audit.columns.actor'), key: 'actor', render: (_, row) => actorCell(row) },
    { title: t('audit.columns.entity'), key: 'entity', render: (_, row) => entityCell(row) },
    {
      title: t('audit.columns.ip'),
      key: 'ip',
      // An IPv4 address the server saw through an IPv6 socket reads `::ffff:127.0.0.1`; show the IPv4 part.
      render: (_, row) =>
        row.ipAddress ? (
          <Typography.Text style={{ whiteSpace: 'nowrap' }}>
            <bdi dir="ltr">{row.ipAddress.replace(/^::ffff:/i, '')}</bdi>
          </Typography.Text>
        ) : (
          EMPTY
        ),
    },
  ]

  const failure = log.error ? describeAuditFailure(log.error) : null

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />

      <Card>
        <Form<AuditFilterValues> form={form} layout="vertical" initialValues={EMPTY_FILTER_VALUES} onFinish={apply} className="audit-filters" style={{ marginBottom: 16 }}>
          <Flex gap={12} wrap align="flex-start">
            <Form.Item name="action" label={t('audit.filters.action')} tooltip={t('audit.filters.actionHint')} style={{ marginBottom: 0, minWidth: 220 }}>
              <AutoComplete
                className="audit-ltr-field"
                options={ACTION_OPTIONS}
                filterOption={(input, option) => Boolean(option?.value.startsWith(input.trim()))}
                onSearch={() => {
                  pickedByArrow.current = false
                }}
                onOpenChange={(open) => {
                  if (open) pickedByArrow.current = false
                }}
                onKeyDown={keepTypedPrefixOnEnter}
                allowClear
                placeholder="users."
              />
            </Form.Item>
            <Form.Item name="actorUserId" label={t('audit.filters.actor')} style={{ marginBottom: 0, minWidth: 220 }}>
              <Input dir="ltr" className="audit-ltr-field" allowClear placeholder="uuid" />
            </Form.Item>
            <Form.Item name="entityType" label={t('audit.filters.entityType')} style={{ marginBottom: 0, minWidth: 140 }}>
              <Input dir="ltr" className="audit-ltr-field" allowClear placeholder="users" />
            </Form.Item>
            <Form.Item name="entityId" label={t('audit.filters.entityId')} style={{ marginBottom: 0, minWidth: 220 }}>
              <Input dir="ltr" className="audit-ltr-field" allowClear />
            </Form.Item>
            <Form.Item name="before" label={t('audit.filters.before')} style={{ marginBottom: 0 }}>
              <Input type="datetime-local" dir="ltr" className="audit-ltr-field" />
            </Form.Item>
            <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
              {/* The three buttons wrap at 390 px: one row of 321 px widened the page to 438 px (CH-0297, real browser). */}
              <Space wrap data-testid="audit-filter-actions">
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                  {t('audit.apply')}
                </Button>
                <Button onClick={reset}>{t('audit.reset')}</Button>
                <Button icon={<ReloadOutlined />} onClick={log.reload} aria-label={t('audit.refresh')} />
              </Space>
            </Form.Item>
          </Flex>
        </Form>

        {failure ? (
          <Alert
            type="error"
            showIcon
            message={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={log.reload}>
                {t('audit.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<AuditLogItem>
          rowKey="id"
          columns={columns}
          dataSource={log.items}
          loading={log.loading}
          pagination={false}
          size="middle"
          // On a phone the table scrolls inside its own box instead of widening the page (889 px at 390 px — QA
          // 2026-11-17; KI-094). `true`, not 'max-content': the table still fills its box wherever it fits, and an
          // opened row never sizes it (KI-099 — EventDetails sits in a box of no width of its own).
          scroll={{ x: true }}
          locale={{ emptyText: t('audit.empty') }}
          expandable={{ expandedRowRender: (row) => <EventDetails row={row} /> }}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('audit.pagination.page', { page: log.pageNumber })}</Typography.Text>
            <Select<AuditFilters['limit']>
              aria-label={t('common.pageSize')}
              size="small"
              value={log.filters.limit}
              onChange={(value) => log.setFilters({ limit: value })}
              options={AUDIT_PAGE_SIZES.map((size) => ({ value: size, label: t('audit.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={log.back} disabled={!log.canGoBack || log.loading}>
              {t('audit.pagination.previous')}
            </Button>
            <Button onClick={log.next} disabled={!log.nextCursor || log.loading}>
              {t('audit.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>
    </>
  )
}

/**
 * The expanded row never widens the table (KI-099): a box of no width of its own that grows to the cell's
 * (`min-width: 100%`) gives the table nothing to size its columns by — the user agent and the full ids wrap inside it
 * (`overflow-wrap: anywhere` breaks an id, which has no space), the metadata JSON scrolls in its own <pre>.
 */
const EXPANDED_ROW_STYLE: CSSProperties = { width: 0, minWidth: '100%', overflowWrap: 'anywhere' }

/** Expanded row: the full identifiers, the user agent and the metadata as the server stored it. */
function EventDetails({ row }: { row: AuditLogItem }) {
  const { t } = useTranslation()
  const text = metadataText(row.metadata)
  return (
    <div style={EXPANDED_ROW_STYLE} data-testid="audit-event-details">
      <Space orientation="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {t('audit.details.id')}:{' '}
          <Typography.Text code>
            <bdi dir="ltr">{row.id}</bdi>
          </Typography.Text>
        </Typography.Text>
        {row.actorUserId ? (
          <Typography.Text type="secondary">
            {t('audit.columns.actor')}:{' '}
            <Typography.Text code>
              <bdi dir="ltr">{row.actorUserId}</bdi>
            </Typography.Text>
          </Typography.Text>
        ) : null}
        {row.entityId ? (
          <Typography.Text type="secondary">
            {t('audit.columns.entity')}:{' '}
            <Typography.Text code>
              <bdi dir="ltr">
                {row.entityType} / {row.entityId}
              </bdi>
            </Typography.Text>
          </Typography.Text>
        ) : null}
        {row.userAgent ? (
          <Typography.Text type="secondary">
            {t('audit.details.userAgent')}: <bdi dir="ltr">{row.userAgent}</bdi>
          </Typography.Text>
        ) : null}
        {text ? (
          <pre dir="ltr" style={{ margin: 0, maxHeight: 320, overflow: 'auto', fontSize: 12 }}>
            {text}
          </pre>
        ) : (
          <Typography.Text type="secondary">{t('audit.details.noMetadata')}</Typography.Text>
        )}
      </Space>
    </div>
  )
}
