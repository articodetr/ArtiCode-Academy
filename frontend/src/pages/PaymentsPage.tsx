// Payments (MOD-11 — API-140..API-155): the office view for holders of
// `invoices.read_all`, `invoices.manage` or `payments.record` — up to three
// tabs, each shown only to a holder of a key the server checks for it:
// invoices (the list, the invoice drawer, drafts, the class batch, payments),
// fee plans (`fee_plans.manage` or `invoices.manage`) and recorded payments
// (the three invoice read keys). The chosen tab lives in the address
// (`?tab=`), as the dashboard keeps `?view=`. «My invoices» (API-155) for
// students and guardians who hold `invoices.read_own` / `invoices.read_linked`
// and none of the office keys. The server stays the boundary.
import { Alert, Tabs } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { PageHeader } from '../components/PageHeader'
import { FeePlansTab } from '../payments/FeePlansTab'
import { MyInvoices } from '../payments/MyInvoices'
import { OfficeInvoices } from '../payments/OfficeInvoices'
import { RecordedPayments } from '../payments/RecordedPayments'
import { officeTabsOf, paymentsViewOf } from '../payments/payments.format'
import type { OfficeTab } from '../payments/payments.format'

export function PaymentsPage() {
  const { t } = useTranslation()
  const { hasPermission } = useAuth()
  const view = paymentsViewOf(hasPermission)
  const [params, setParams] = useSearchParams()
  const tabs = officeTabsOf(hasPermission)
  const asked = params.get('tab') as OfficeTab | null
  const tab: OfficeTab | undefined = asked && tabs.includes(asked) ? asked : tabs[0]

  const content: Record<OfficeTab, ReactNode> = {
    invoices: <OfficeInvoices />,
    feePlans: <FeePlansTab />,
    payments: <RecordedPayments />,
  }

  return (
    <>
      <PageHeader title={t(view === 'learner' ? 'payments.mine.title' : 'payments.title')} subtitle={t(view === 'learner' ? 'payments.mine.subtitle' : 'payments.subtitle')} />
      {view === 'office' && tabs.length > 1 ? (
        <Tabs
          activeKey={tab}
          onChange={(key) => {
            const next = new URLSearchParams(params)
            if (key === tabs[0]) next.delete('tab')
            else next.set('tab', key)
            setParams(next, { replace: true })
          }}
          items={tabs.map((key) => ({ key, label: t(`payments.tabs.${key}`) }))}
        />
      ) : null}
      {view === 'office' && tab ? content[tab] : null}
      {view === 'learner' ? <MyInvoices /> : null}
      {view === 'none' ? <Alert type="info" showIcon title={t('payments.noAccess')} /> : null}
    </>
  )
}
