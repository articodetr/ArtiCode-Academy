// A receipt to print (J-F52 — D-R63): the academy's name and logo (the shared
// API-035 reading — useAcademyBrand), the receipt number `RCPT-YYYY-NNNNN`, the
// moment, the amount in the invoice currency, the method, the reference and
// the payer, the student and the invoice with its numbers as the server sent
// them now; the recorder on the office's copy; a reversed payment says so in
// large letters (the receipt is no longer valid). The browser prints it: the
// page has no app chrome, and the toolbar (print, back) is hidden in print
// (ReceiptView.css). The internal note is never printed.
import { PrinterOutlined } from '@ant-design/icons'
import { Button, Card, Descriptions, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAcademyBrand } from '../academy/useAcademyBrand'
import { useLocalized } from '../i18n/useLocalized'
import { formatDateTime } from '../users/users.format'
import { Money } from './FinanceTags'
import type { ReceiptData } from './receipt'
import './ReceiptView.css'

interface ReceiptViewProps {
  receipt: ReceiptData
  /** Where «back» goes when the page has no history to go back to (opened in a new tab). */
  backTo: string
}

export function ReceiptView({ receipt, backTo }: ReceiptViewProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const navigate = useNavigate()
  const brand = useAcademyBrand()
  const reversed = receipt.status === 'reversed'
  // The moment the sheet was opened (printed with it), fixed for the page's lifetime.
  const [printedAt] = useState(() => new Date().toISOString())

  return (
    <div className="receipt-sheet" data-testid="receipt">
      <div className="receipt-toolbar">
        <Button
          onClick={() => {
            if (window.history.length > 1) navigate(-1)
            else navigate(backTo)
          }}
        >
          {t('payments.receipt.back')}
        </Button>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          {t('payments.receipt.print')}
        </Button>
      </div>
      <Card>
        <div className="receipt-head">
          <div className="receipt-head__brand">
            {brand.logoSrc ? <img className="receipt-head__logo" src={brand.logoSrc} alt="" referrerPolicy="no-referrer" /> : null}
            <Typography.Title level={4} style={{ margin: 0 }}>
              <bdi dir="auto">{brand.name || t('common.appName')}</bdi>
            </Typography.Title>
          </div>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t('payments.receipt.title')}
            </Typography.Title>
            <Typography.Text strong dir="ltr" data-testid="receipt-number">
              {receipt.number}
            </Typography.Text>
          </div>
        </div>
        {reversed ? (
          <Typography.Paragraph type="danger" className="receipt-reversed" data-testid="receipt-reversed">
            {t('payments.receipt.reversed')}
            {receipt.reversedAt ? (
              <>
                <br />
                <span style={{ fontWeight: 400 }}>{t('payments.receipt.reversedAt', { date: formatDateTime(receipt.reversedAt, language), reason: receipt.reverseReason ?? '—' })}</span>
              </>
            ) : null}
          </Typography.Paragraph>
        ) : null}
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('payments.receipt.student')}>{receipt.studentName}</Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.amount')}>
            <Money amount={receipt.amount} currency={receipt.currency} strong />
          </Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.paidAt')}>{formatDateTime(receipt.paidAt, language)}</Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.method')}>{t(`finance.methods.${receipt.method}`)}</Descriptions.Item>
          {receipt.reference ? (
            <Descriptions.Item label={t('payments.receipt.reference')}>
              <bdi>{receipt.reference}</bdi>
            </Descriptions.Item>
          ) : null}
          {receipt.payerName ? <Descriptions.Item label={t('payments.receipt.payerName')}>{receipt.payerName}</Descriptions.Item> : null}
          <Descriptions.Item label={t('payments.receipt.invoice')}>
            <bdi dir="ltr">{receipt.invoiceNumber ?? '—'}</bdi>
          </Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.invoiceTotal')}>
            <Money amount={receipt.invoiceTotal} currency={receipt.currency} />
          </Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.invoicePaid')}>
            <Money amount={receipt.invoicePaid} currency={receipt.currency} />
          </Descriptions.Item>
          <Descriptions.Item label={t('payments.receipt.invoiceBalance')}>
            <Money amount={receipt.invoiceBalance} currency={receipt.currency} />
          </Descriptions.Item>
          {receipt.recordedBy ? <Descriptions.Item label={t('payments.receipt.recordedBy')}>{receipt.recordedBy}</Descriptions.Item> : null}
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t('payments.receipt.invoiceNow')} {t('payments.receipt.printedAt', { date: formatDateTime(printedAt, language) })}
        </Typography.Paragraph>
      </Card>
    </div>
  )
}
