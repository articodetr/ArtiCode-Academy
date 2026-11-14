// A reason dialog for the two finance actions that need one: cancelling an
// issued invoice (API-149) and reversing a payment (API-154). The reason is
// required, 1..500 characters after trim, and kept on the record by the server.
import { Alert, Form, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FINANCE_REASON_MAX } from '../api/invoices'

interface ReasonModalProps {
  open: boolean
  title: string
  description: string
  okText: string
  onCancel: () => void
  /** Sends the request; a thrown error is shown as `failure(error)` and keeps the dialog open. */
  onSubmit: (reason: string) => Promise<void>
  failure: (error: unknown) => string
}

export function ReasonModal(props: ReasonModalProps) {
  return props.open ? <ReasonBody {...props} /> : null
}

function ReasonBody({ title, description, okText, onCancel, onSubmit, failure }: ReasonModalProps) {
  const { t } = useTranslation()
  const [form] = Form.useForm<{ reason?: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    let values: { reason?: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit((values.reason ?? '').trim())
    } catch (caught) {
      setError(failure(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={title} okText={okText} cancelText={t('common.cancel')} okButtonProps={{ danger: true }} onOk={submit} onCancel={onCancel} confirmLoading={busy} destroyOnHidden>
      <p>{description}</p>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form form={form} layout="vertical">
        <Form.Item
          name="reason"
          label={t('payments.reason.label')}
          rules={[
            { required: true, whitespace: true, message: t('payments.reason.required') },
            { max: FINANCE_REASON_MAX, message: t('payments.record.tooLong', { max: FINANCE_REASON_MAX }) },
          ]}
        >
          <Input.TextArea rows={3} dir="auto" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
