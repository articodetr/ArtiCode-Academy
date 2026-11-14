// The office view of /payments (MOD-11 — API-144/145): the invoices list with
// filters (number search, student, status, payment state, overdue only) and
// keyset pages; a row opens the invoice drawer, docked beside the list on a
// wide screen. For holders of `invoices.read_all`, `invoices.manage` or
// `payments.record`. Every amount is the server's. With `invoices.manage`:
// «new invoice» (a draft — CreateInvoiceModal, API-146) and «bill a whole
// class» (ClassBatchModal, API-150); both re-read the list.
import { PlusOutlined, ReloadOutlined, TeamOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Flex, Input, Select, Space, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FINANCE_SEARCH_MAX_LENGTH, INVOICE_STATUSES, PAYMENT_STATES } from '../api/invoices'
import type { InvoiceSummary } from '../api/invoices'
import { useAcademy } from '../academy/useAcademy'
import { useAuth } from '../auth/auth-context'
import { StudentPicker } from '../classes/ClassPickers'
import { useDockedPanel } from '../common/useDockedPanel'
import { useLocalized } from '../i18n/useLocalized'
import { formatDay, localizedLabel } from '../users/users.format'
import { ClassBatchModal } from './ClassBatchModal'
import { CreateInvoiceModal } from './CreateInvoiceModal'
import { FinanceTag } from './FinanceTag'
import { InvoiceDrawer } from './InvoiceDrawer'
import { describePaymentsFailure, failureMessage } from './payments.errors'
import { formatMoney, personName } from './payments.format'
import { INVOICE_PAGE_SIZES, useInvoicesList } from './useInvoicesList'
import type { InvoicesListFilters } from './useInvoicesList'
import './payments.css'
import { useOpenFromSearch } from '../common/useOpenFromSearch'

export function OfficeInvoices() {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { hasPermission } = useAuth()
  const { message } = App.useApp()
  const canPickStudent = hasPermission('users.read')
  const canManage = hasPermission('invoices.manage')
  const { academy } = useAcademy()
  const list = useInvoicesList()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The global search opens a record here through `?open=<id>`.
  useOpenFromSearch(setSelectedId)
  const [creating, setCreating] = useState(false)
  const [batching, setBatching] = useState(false)
  const { docked, dockedIn, panelRef, wide, onUnsavedChange, open: openInvoice, layoutClassName } = useDockedPanel(selectedId, setSelectedId)

  const money = (row: InvoiceSummary, amount: number) => <bdi dir="ltr">{formatMoney(amount, row.currency, language)}</bdi>

  const columns: TableProps<InvoiceSummary>['columns'] = [
    {
      title: t('payments.columns.number'),
      key: 'number',
      render: (_, row) => (
        <span className="list-primary">
          <b>
            <bdi dir="ltr">{row.number ?? t('payments.drawer.draftTitle')}</bdi>
          </b>
          {row.enrollment ? <small>{localizedLabel(row.enrollment.class.name, language)}</small> : null}
        </span>
      ),
    },
    { title: t('common.student'), key: 'student', render: (_, row) => personName(row.student) },
    { title: t('payments.columns.total'), key: 'total', align: 'end', render: (_, row) => money(row, row.total) },
    { title: t('payments.columns.paid'), key: 'paid', align: 'end', render: (_, row) => money(row, row.paid) },
    {
      title: t('payments.columns.balance'),
      key: 'balance',
      align: 'end',
      render: (_, row) => <span className={row.overdue ? 'finance-overdue' : undefined}>{money(row, row.balance)}</span>,
    },
    {
      title: t('payments.columns.nextDue'),
      key: 'nextDue',
      render: (_, row) =>
        row.nextDue && row.status === 'issued' ? (
          <span className={row.overdue ? 'finance-overdue' : undefined}>
            {formatDay(row.nextDue.dueOn, language)} · <bdi dir="ltr">{formatMoney(row.nextDue.remaining, row.currency, language)}</bdi>
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: t('common.status'),
      key: 'status',
      render: (_, row) => (
        <Space size={4} wrap>
          <FinanceTag value={row.status === 'issued' ? row.paymentState : row.status} />
          {row.overdue ? <FinanceTag value="overdue" /> : null}
        </Space>
      ),
    },
  ]

  const failure = list.error ? describePaymentsFailure(list.error) : null
  const filtered = Boolean(list.filters.q || list.filters.studentId || list.filters.status || list.filters.balance || list.filters.overdue)

  return (
    <div className={layoutClassName}>
      <Card className="list-with-panel__main">
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('payments.filters.searchPlaceholder')}
            aria-label={t('common.search')}
            maxLength={FINANCE_SEARCH_MAX_LENGTH}
            defaultValue={list.filters.q}
            onSearch={(value) => list.setFilters({ q: value.trim() || undefined })}
            style={{ maxWidth: 260 }}
          />
          {canPickStudent ? (
            <StudentPicker
              allowClear
              placeholder={t('payments.filters.allStudents')}
              aria-label={t('common.student')}
              value={list.filters.studentId}
              onChange={(value) => list.setFilters({ studentId: value })}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Select<InvoicesListFilters['status']>
            allowClear
            placeholder={t('payments.filters.allStatuses')}
            aria-label={t('common.status')}
            value={list.filters.status}
            onChange={(value) => list.setFilters({ status: value })}
            options={INVOICE_STATUSES.map((status) => ({ value: status, label: t(`payments.status.${status}`) }))}
            style={{ minWidth: 140 }}
          />
          <Select<InvoicesListFilters['balance']>
            allowClear
            placeholder={t('payments.filters.allBalances')}
            aria-label={t('payments.filters.balance')}
            value={list.filters.balance}
            onChange={(value) => list.setFilters({ balance: value })}
            options={PAYMENT_STATES.map((state) => ({ value: state, label: t(`payments.status.${state}`) }))}
            style={{ minWidth: 140 }}
          />
          <Checkbox checked={list.filters.overdue === true} onChange={(event) => list.setFilters({ overdue: event.target.checked ? true : undefined })}>
            {t('payments.filters.overdueOnly')}
          </Checkbox>
          <Button icon={<ReloadOutlined />} onClick={list.reload} aria-label={t('payments.refresh')} />
          {canManage ? (
            <Space wrap style={{ marginInlineStart: 'auto' }}>
              <Button icon={<TeamOutlined />} onClick={() => setBatching(true)}>
                {t('payments.batch.action')}
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                {t('payments.draft.action')}
              </Button>
            </Space>
          ) : null}
        </Flex>

        {failure ? (
          <Alert
            type="error"
            showIcon
            title={failureMessage(t, failure)}
            action={
              <Button size="small" onClick={() => (failure.key.endsWith('cursor_invalid') ? list.setFilters({}) : list.reload())}>
                {t('payments.refresh')}
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<InvoiceSummary>
          rowKey="id"
          columns={docked ? columns.filter((column) => ['number', 'student', 'balance', 'status'].includes(String(column.key))) : columns}
          dataSource={list.items}
          loading={list.loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: filtered ? t('payments.emptyFiltered') : t('payments.empty') }}
          onRow={(row) => ({ onClick: () => openInvoice(row.id), style: { cursor: 'pointer' } })}
          rowClassName={(row) => (row.id === selectedId ? 'list-row--open' : '')}
        />

        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text type="secondary">{t('payments.pagination.page', { page: list.pageNumber })}</Typography.Text>
            <Select<InvoicesListFilters['limit']>
              size="small"
              value={list.filters.limit}
              aria-label={t('payments.pagination.pageSizeLabel')}
              onChange={(value) => list.setFilters({ limit: value })}
              options={INVOICE_PAGE_SIZES.map((size) => ({ value: size, label: t('payments.pagination.pageSize', { count: size }) }))}
            />
          </Space>
          <Space>
            <Button onClick={list.back} disabled={!list.canGoBack || list.loading}>
              {t('payments.pagination.previous')}
            </Button>
            <Button onClick={list.next} disabled={!list.nextCursor || list.loading}>
              {t('payments.pagination.next')}
            </Button>
          </Space>
        </Flex>
      </Card>
      {wide ? <aside ref={panelRef} className="list-panel" aria-hidden={!docked} /> : null}

      <InvoiceDrawer
        key={docked ? selectedId : 'overlay'}
        invoiceId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={list.replaceItem}
        onDeleted={(id) => {
          list.removeItem(id)
          setSelectedId(null)
        }}
        dockedIn={dockedIn}
        onUnsavedChange={onUnsavedChange}
      />

      <CreateInvoiceModal
        open={creating}
        currency={academy?.currency ?? ''}
        onClose={() => setCreating(false)}
        onCreated={(invoice) => {
          setCreating(false)
          message.success(t('payments.draft.created'))
          list.reload()
          openInvoice(invoice.id)
        }}
      />
      <ClassBatchModal open={batching} onClose={() => setBatching(false)} onDone={() => list.reload()} />
    </div>
  )
}
