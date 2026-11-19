// «طلبات الاشتراك» — the office's enrollment requests (MOD-19, roadmap §4p):
// API-224 with a state filter (the server's default `pending`), a debounced
// search over the student's name and the class code, and keyset pages; the
// server's academy-wide `pendingCount` heads the page. A row opens the details
// drawer (API-225), where the request is approved or rejected (API-059) and,
// for holders of `payments.record`, its invoice is paid (API-151). The nav
// entry and the route need `enrollments.manage` — the key the server enforces.
import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Badge, Button, Card, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnrollmentRequest, RequestListState } from '../api/enrollmentRequests'
import { PageHeader } from '../components/PageHeader'
import { EnrollmentRequestDrawer } from '../enrollmentRequests/EnrollmentRequestDrawer'
import { PaymentStateTag, RequestStateTag } from '../enrollmentRequests/RequestTags'
import { describeRequestsFailure, failureMessage } from '../enrollmentRequests/requests.errors'
import { REQUEST_SEARCH_MAX_LENGTH, REQUEST_STATE_FILTERS, requestSearchOf } from '../enrollmentRequests/requests.format'
import { useEnrollmentRequests } from '../enrollmentRequests/useEnrollmentRequests'
import { useLocalized } from '../i18n/useLocalized'
import { formatMoney } from '../payments/payments.format'
import { displayNameOf, formatDateTime, localizedLabel } from '../users/users.format'

/** The search is sent once the typing pauses this long. */
export const REQUEST_SEARCH_DEBOUNCE_MS = 300

export function EnrollmentRequestsPage() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const list = useEnrollmentRequests()
  const { setFilters } = list
  const appliedQ = list.filters.q
  const [text, setText] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // The search goes out once the typing pauses; the same search again is no new request.
  useEffect(() => {
    const q = requestSearchOf(text)
    if (q === appliedQ) return
    const timer = setTimeout(() => setFilters({ q }), REQUEST_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, appliedQ, setFilters])

  const columns: TableProps<EnrollmentRequest>['columns'] = [
    {
      title: t('enrollmentRequests.columns.student'),
      key: 'student',
      render: (_, row) => <Typography.Text strong>{displayNameOf(row.student)}</Typography.Text>,
    },
    { title: t('enrollmentRequests.columns.course'), key: 'course', render: (_, row) => localizedLabel(row.course.name, language) },
    {
      title: t('enrollmentRequests.columns.class'),
      key: 'class',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{localizedLabel(row.class.name, language)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <bdi dir="ltr">{row.class.code}</bdi>
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('enrollmentRequests.columns.price'),
      key: 'price',
      render: (_, row) =>
        row.payment.currency ? <bdi dir="ltr">{formatMoney(row.payment.total, row.payment.currency, language)}</bdi> : t(`enrollmentRequests.pricing.${row.course.pricing}`),
    },
    { title: t('enrollmentRequests.columns.payment'), key: 'payment', render: (_, row) => <PaymentStateTag state={row.payment.state} /> },
    { title: t('enrollmentRequests.columns.requestedAt'), key: 'requestedAt', render: (_, row) => formatDateTime(row.requestedAt, language) },
    { title: t('enrollmentRequests.columns.state'), key: 'state', render: (_, row) => <RequestStateTag state={row.state} /> },
    {
      title: t('enrollmentRequests.columns.actions'),
      key: 'actions',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            setSelectedId(row.id)
          }}
          aria-label={`${t('enrollmentRequests.view')}: ${displayNameOf(row.student)}`}
        >
          {t('enrollmentRequests.view')}
        </Button>
      ),
    },
  ]

  const failure = list.error ? describeRequestsFailure(list.error) : null
  const emptyText = list.filters.q ? t('enrollmentRequests.emptyFiltered') : t('enrollmentRequests.empty')

  return (
    <>
      <PageHeader
        title={t('enrollmentRequests.title')}
        subtitle={t('enrollmentRequests.subtitle')}
        extra={
          list.pendingCount !== null ? (
            <Badge color={list.pendingCount > 0 ? 'gold' : 'green'} text={<span data-testid="pending-count">{t('enrollmentRequests.pendingCount', { count: list.pendingCount })}</span>} />
          ) : null
        }
      />

      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Select<RequestListState>
            aria-label={t('enrollmentRequests.stateLabel')}
            value={list.filters.state}
            onChange={(value) => setFilters({ state: value })}
            options={REQUEST_STATE_FILTERS.map((state) => ({ value: state, label: t(`enrollmentRequests.filters.${state}`) }))}
            style={{ minWidth: 180 }}
          />
          <Input
            allowClear
            aria-label={t('enrollmentRequests.searchLabel')}
            placeholder={t('enrollmentRequests.searchPlaceholder')}
            maxLength={REQUEST_SEARCH_MAX_LENGTH}
            value={text}
            onChange={(event) => setText(event.target.value)}
            style={{ maxWidth: 300 }}
          />
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('enrollmentRequests.refresh')} />
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? setFilters({}) : list.reload())}>
                {t('enrollmentRequests.retry')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<EnrollmentRequest>
          rowKey="id"
          columns={columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: true }}
          locale={{ emptyText }}
          onRow={(row) => ({ onClick: () => setSelectedId(row.id), style: { cursor: 'pointer' } })}
        />

        {list.canGoBack || list.nextCursor ? (
          <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">{t('enrollmentRequests.page', { page: list.pageNumber })}</Typography.Text>
            <Space>
              <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
                {t('enrollmentRequests.previous')}
              </Button>
              <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
                {t('enrollmentRequests.next')}
              </Button>
            </Space>
          </Flex>
        ) : null}
      </Card>

      <EnrollmentRequestDrawer requestId={selectedId} onClose={() => setSelectedId(null)} onChanged={list.reload} />
    </>
  )
}
