// Small display pieces of the finance screens (J-F52): the tags of the stored
// and computed states — every state is the server's (D-R61..D-R63) — and an
// amount in its currency. finance.* carries the texts.
import { Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { InstallmentStatus, InvoiceStatus, PaymentState } from '../api/invoices'
import type { PaymentStatus } from '../api/payments'
import { useLocalized } from '../i18n/useLocalized'
import { INSTALLMENT_STATUS_COLORS, INVOICE_STATUS_COLORS, PAYMENT_STATE_COLORS, PAYMENT_STATUS_COLORS, formatMoney } from './finance.format'

export function InvoiceStatusTag({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation()
  return <Tag color={INVOICE_STATUS_COLORS[status]}>{t(`finance.invoiceStatus.${status}`)}</Tag>
}

export function PaymentStateTag({ state }: { state: PaymentState }) {
  const { t } = useTranslation()
  return <Tag color={PAYMENT_STATE_COLORS[state]}>{t(`finance.paymentState.${state}`)}</Tag>
}

export function InstallmentStatusTag({ status }: { status: InstallmentStatus }) {
  const { t } = useTranslation()
  return <Tag color={INSTALLMENT_STATUS_COLORS[status]}>{t(`finance.installmentStatus.${status}`)}</Tag>
}

export function PaymentStatusTag({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation()
  return <Tag color={PAYMENT_STATUS_COLORS[status]}>{t(`finance.paymentStatus.${status}`)}</Tag>
}

export function OverdueTag() {
  const { t } = useTranslation()
  return <Tag color="red">{t('finance.overdue')}</Tag>
}

/** An amount as the server sent it, in its currency (Latin digits), isolated from the text around it. */
export function Money({ amount, currency, strong }: { amount: number | null | undefined; currency: string | null | undefined; strong?: boolean }) {
  const { language } = useLocalized()
  const text = formatMoney(amount, currency, language)
  return <bdi style={strong ? { fontWeight: 600 } : undefined}>{text}</bdi>
}
