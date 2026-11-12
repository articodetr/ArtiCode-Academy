// The revocation dialog of a certificate (J-F51 on API-133): a required reason
// (1..500 characters after trimming — D-R55), sent once; the revocation is
// final. The dialog shows the server's answer only: on success it hands the
// revoked certificate back; a certificate revoked meanwhile or gone
// (isStaleRevocation) closes the dialog with the message so the drawer reads
// it again; anything retryable (network, 5xx, 429) or refused (403) keeps the
// dialog and the reason. While a reason is typed, Escape and a mask click no
// longer close the dialog, and «cancel» or the close button ask first.
import { Alert, App, Form, Input, Modal, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { REVOKE_REASON_MAX_LENGTH, revokeCertificate } from '../api/certificates'
import type { Certificate } from '../api/certificates'
import { describeCertificatesFailure, failureMessage, isStaleRevocation } from './certificates.errors'

interface RevokeCertificateModalProps {
  certificate: Certificate
  /** The revoked certificate as the server returned it. */
  onDone: (certificate: Certificate) => void
  /** The certificate changed elsewhere (the message is already shown): close the dialog and read it again. */
  onStale: () => void
  onCancel: () => void
}

export function RevokeCertificateModal({ certificate, onDone, onStale, onCancel }: RevokeCertificateModalProps) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = reason.trim()
  const typed = trimmed.length > 0
  const missing = submitted && !typed

  const submit = async () => {
    setSubmitted(true)
    if (!typed || busy) return
    setBusy(true)
    setError(null)
    try {
      const revoked = await revokeCertificate(certificate.id, { reason: trimmed })
      message.success(t('certificates.revoke.done', { serial: revoked.serial }))
      onDone(revoked)
    } catch (caught) {
      const failure = describeCertificatesFailure(caught)
      const text = failureMessage(t, failure)
      if (isStaleRevocation(failure)) {
        message.error(text)
        onStale()
        return
      }
      setError(text)
      setBusy(false)
    }
  }

  const cancel = () => {
    if (busy) return
    if (!typed) {
      onCancel()
      return
    }
    modal.confirm({
      title: t('certificates.revoke.discard.title'),
      content: t('certificates.revoke.discard.content'),
      okText: t('certificates.revoke.discard.ok'),
      okButtonProps: { danger: true },
      cancelText: t('certificates.revoke.discard.cancel'),
      onOk: () => onCancel(),
    })
  }

  return (
    <Modal
      open
      title={t('certificates.revoke.title', { serial: certificate.serial })}
      okText={t('certificates.revoke.submit')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      // A typed reason is not dropped by a stray Escape or click outside (the buttons ask first).
      keyboard={!typed}
      mask={{ closable: !typed }}
      onOk={() => void submit()}
      onCancel={cancel}
    >
      <Typography.Paragraph>{t('certificates.revoke.intro')}</Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item
          label={t('certificates.revoke.reason')}
          required
          htmlFor="certificate-revoke-reason"
          validateStatus={missing ? 'error' : undefined}
          help={missing ? t('certificates.revoke.reasonRequired') : t('certificates.revoke.reasonHint')}
        >
          <Input.TextArea
            id="certificate-revoke-reason"
            rows={3}
            maxLength={REVOKE_REASON_MAX_LENGTH}
            showCount
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
