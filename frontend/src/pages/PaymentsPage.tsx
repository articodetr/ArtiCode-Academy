// Payments (MOD-11 — J-F52, MOD-11-T07): the real page instead of the mock.
// Two tabs on the same page: the invoices (API-144) and the receipts (API-152),
// both academy-wide (no class visibility — D-R65) for a holder of
// `invoices.read_all`, `invoices.manage` or `payments.record` (the nav entry and
// the route follow the same rule; the server stays the boundary). One invoice
// drawer for both (API-145 — opened from an invoice row or from a receipt's
// invoice). A holder of `invoices.manage` adds a draft (API-146) and invoices a
// class from a fee plan (API-150). Every amount, balance, payment state and
// overdue flag is the server's (D-R62, ADR-068): the page computes none, and
// after every write the lists read the page on screen again.
import { FileAddOutlined, TeamOutlined } from '@ant-design/icons'
import { Button, Space, Tabs, Tooltip } from 'antd'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { ClassInvoicesModal } from '../finance/ClassInvoicesModal'
import { CreateInvoiceModal } from '../finance/CreateInvoiceModal'
import { InvoiceDrawer } from '../finance/InvoiceDrawer'
import { InvoicesTab } from '../finance/InvoicesTab'
import { ReceiptsTab } from '../finance/ReceiptsTab'
import { INVOICES_MANAGE_PERMISSION } from '../finance/finance.policy'

type PaymentsTabKey = 'invoices' | 'receipts'

export function PaymentsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const canManage = hasPermission(INVOICES_MANAGE_PERMISSION)
  // A new invoice needs a student: from a class roster (classes.read + enrollments.read) or by name (users.read).
  const canPickStudent = (hasPermission('classes.read') && hasPermission('enrollments.read')) || hasPermission('users.read')
  const canPickClass = hasPermission('classes.read')
  const [tab, setTab] = useState<PaymentsTabKey>('invoices')
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [batching, setBatching] = useState(false)
  const [invoicesRefresh, setInvoicesRefresh] = useState(0)
  const [receiptsRefresh, setReceiptsRefresh] = useState(0)

  /** A write changed invoices or payments: both lists read their page again (the server's numbers). */
  const refreshAll = useCallback(() => {
    setInvoicesRefresh((tick) => tick + 1)
    setReceiptsRefresh((tick) => tick + 1)
  }, [])

  return (
    <>
      <PageHeader
        title={t('payments.title')}
        subtitle={t('payments.subtitle')}
        extra={
          canManage ? (
            <Space wrap>
              {/* A disabled button swallows the pointer events, so the hint sits on a wrapper. */}
              <Tooltip title={canPickClass ? undefined : t('payments.hints.needsClassesRead')}>
                <span style={{ display: 'inline-block' }}>
                  <Button icon={<TeamOutlined />} disabled={!canPickClass} onClick={() => setBatching(true)}>
                    {t('payments.classInvoices')}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={canPickStudent ? undefined : t('payments.hints.needsPicker')}>
                <span style={{ display: 'inline-block' }}>
                  <Button type="primary" icon={<FileAddOutlined />} disabled={!canPickStudent} onClick={() => setCreating(true)}>
                    {t('payments.newInvoice')}
                  </Button>
                </span>
              </Tooltip>
            </Space>
          ) : null
        }
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as PaymentsTabKey)}
        items={[
          { key: 'invoices', label: t('payments.tabs.invoices'), children: <InvoicesTab onOpen={setOpenInvoiceId} refreshKey={invoicesRefresh} /> },
          {
            key: 'receipts',
            label: t('payments.tabs.receipts'),
            children: <ReceiptsTab onOpenInvoice={setOpenInvoiceId} refreshKey={receiptsRefresh} onReversed={() => setInvoicesRefresh((tick) => tick + 1)} />,
          },
        ]}
      />

      <InvoiceDrawer invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} onChanged={refreshAll} />

      {creating ? (
        <CreateInvoiceModal
          onClose={() => setCreating(false)}
          onCreated={(invoice) => {
            setCreating(false)
            setTab('invoices')
            setInvoicesRefresh((tick) => tick + 1)
            setOpenInvoiceId(invoice.id)
          }}
        />
      ) : null}

      {batching ? (
        <ClassInvoicesModal
          onClose={() => setBatching(false)}
          onCreated={() => {
            setTab('invoices')
            setInvoicesRefresh((tick) => tick + 1)
          }}
        />
      ) : null}
    </>
  )
}
