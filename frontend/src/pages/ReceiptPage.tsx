// The receipt print pages (J-F52 — MOD-11-T07, D-R63), both outside the app
// chrome so the browser prints the receipt alone:
// - ReceiptPage, `/payments/:id/receipt`: the office's copy (API-153 — the read
//   keys of the invoices; `guarded('payments')`), completed or reversed;
// - MyReceiptPage, `/my-invoices/receipts/:id`: the owner's copy of one of
//   their valid receipts, found in «my invoices» (API-155 — ownership;
//   `guarded('myInvoices')`); a reversed receipt or someone else's is not there.
import { Alert, Button, Card, Skeleton } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { listMyInvoices } from '../api/myInvoices'
import { getPayment } from '../api/payments'
import { ReceiptView } from '../finance/ReceiptView'
import { describeFinanceFailure, failureMessage } from '../finance/finance.errors'
import { findMyReceipt, receiptOfMyInvoice, receiptOfPayment } from '../finance/receipt'
import type { ReceiptData } from '../finance/receipt'
import '../finance/ReceiptView.css'

interface ReceiptState {
  receipt: ReceiptData | null
  /** The text of a failure, or of a receipt that is not there. */
  error: string | null
}

function ReceiptFrame({ state, backTo, onRetry }: { state: ReceiptState | null; backTo: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="receipt-page">
      {state?.receipt ? (
        <ReceiptView receipt={state.receipt} backTo={backTo} />
      ) : (
        <div className="receipt-sheet">
          {state?.error ? (
            <Alert
              type="error"
              showIcon
              title={t('payments.receipt.loadFailed')}
              description={state.error}
              action={
                <Button size="small" onClick={onRetry}>
                  {t('invoices.refresh')}
                </Button>
              }
            />
          ) : (
            <Card>
              <Skeleton active paragraph={{ rows: 8 }} data-testid="receipt-loading" />
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

export function ReceiptPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const [state, setState] = useState<ReceiptState | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getPayment(id, controller.signal).then(
      (payment) => {
        if (!controller.signal.aborted) setState({ receipt: receiptOfPayment(payment), error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ receipt: null, error: failureMessage(t, describeFinanceFailure(error)) })
      },
    )
    return () => controller.abort()
  }, [id, tick, t])

  return <ReceiptFrame state={state} backTo="/payments" onRetry={() => setTick((value) => value + 1)} />
}

export function MyReceiptPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const [state, setState] = useState<ReceiptState | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listMyInvoices({}, controller.signal).then(
      (list) => {
        if (controller.signal.aborted) return
        const found = findMyReceipt(list.items, id)
        setState(found ? { receipt: receiptOfMyInvoice(found.invoice, found.payment), error: null } : { receipt: null, error: t('payments.receipt.notFound') })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ receipt: null, error: failureMessage(t, describeFinanceFailure(error)) })
      },
    )
    return () => controller.abort()
  }, [id, tick, t])

  return <ReceiptFrame state={state} backTo="/my-invoices" onRetry={() => setTick((value) => value + 1)} />
}
