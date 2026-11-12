// A confirmation that needs a reason (J-F52): cancelling an issued invoice
// (API-149 `cancel`) and reversing a payment (API-154) — the reason is
// required, 1..REASON_MAX characters after trimming, and kept on the record.
// Once a reason is typed, Escape and a mask click no longer close the window
// and «إلغاء»/× ask first (finance.unsaved.*); a modal inside a drawer reports
// the typed reason to the drawer (`onUnsavedChange`), whose navigation blocker
// holds a browser back, while one opened from the page holds it itself. The
// parent mounts it per action, so a reason never carries over.
import { Alert, Form, Input, Modal, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { REASON_MAX } from '../api/invoices'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useFinanceUnsavedGuard } from './useFinanceUnsavedGuard'

interface ReasonModalProps {
  title: string
  /** What the action does, above the reason. */
  description: ReactNode
  reasonLabel: string
  okText: string
  /** Sends the action with the trimmed reason; rejects with the text to show (the window stays open). */
  onSubmit: (reason: string) => Promise<void>
  onClose: () => void
  /** Inside a drawer: report the typed reason so the drawer's guard holds navigations; no blocker of its own. */
  onUnsavedChange?: (unsaved: boolean) => void
}

export function ReasonModal({ title, description, reasonLabel, okText, onSubmit, onClose, onUnsavedChange }: ReasonModalProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unsaved = reason.trim() !== ''
  const { requestClose, holdNavigation } = useFinanceUnsavedGuard(unsaved, onClose)

  // The window left (sent, closed, or the drawer closed) — nothing is held any more.
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange])

  const trimmed = reason.trim()
  const problem = !trimmed ? t('finance.validation.reasonRequired') : trimmed.length > REASON_MAX ? t('finance.validation.reasonMax', { max: REASON_MAX }) : null

  const submit = async () => {
    setTouched(true)
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onUnsavedChange?.(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={title}
      okText={okText}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={() => {
        if (!busy) requestClose()
      }}
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      destroyOnHidden
    >
      {onUnsavedChange ? null : <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />}
      <Typography.Paragraph>{description}</Typography.Paragraph>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={reasonLabel} htmlFor="finance-reason" validateStatus={touched && problem ? 'error' : undefined} help={touched && problem ? problem : undefined}>
          <Input.TextArea
            id="finance-reason"
            rows={3}
            value={reason}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value)
              onUnsavedChange?.(event.target.value.trim() !== '')
            }}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
