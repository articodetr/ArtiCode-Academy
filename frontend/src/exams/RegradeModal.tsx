// The «regrade» dialog of the attempts tab (MOD-09 phase 2 — OEX-T07): POST
// /api/exams/:id/regrade (API-273) for a holder of `exams.grade`. The server
// grades every finished attempt again from the exam's frozen questions as they
// are now and rewrites the counted results that change; grading is
// deterministic, so this normally changes nothing — and then nothing is
// written or recorded. The reason is required (1–500 characters after
// trimming) and goes to the audit event with the counts. Mounted per session
// by the tab, so every session has its own form (KI-049). The answer is the
// server's three counts, handed to the tab, which words them and reads the
// roster again. A refusal that no retry can change because the exam is no
// longer what the drawer shows (draft again, manual, its class cancelled,
// gone) is said in a toast, closes the dialog and has the drawer re-read the
// exam; any other one — the class holds issued certificates
// (`grades_certified`), the permission, a validation or a network failure —
// stays in the dialog with the reason kept. While a reason is typed, Escape
// and a mask click do nothing and × and «cancel» ask first
// (examAttempts.regrade.unsaved.* through useUnsavedChangesGuard), and a reload
// or a tab close gets the browser's own prompt. A browser back/forward is not
// held here: the router consults only the blocker mounted last, so a
// NavigationBlocker of this dialog would take the place of the exam drawer's
// own and let the drawer's unsaved work go.
import { Alert, App, Form, Input, Modal, Typography } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CORRECTION_REASON_MAX_LENGTH, regradeExam } from '../api/examQuestions'
import type { RegradeSummary } from '../api/examQuestions'
import type { Exam } from '../api/exams'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { describeAttemptsFailure, failureMessage, isStaleExamFailure } from './examAttempts.errors'

interface RegradeModalProps {
  exam: Pick<Exam, 'id' | 'title'>
  onClose: () => void
  /** The server's counts of the regrade that was done. */
  onDone: (summary: RegradeSummary) => void
  /** The server says the exam changed elsewhere (draft again, manual, its class cancelled, gone): the drawer re-reads it. */
  onStale: () => void
}

interface RegradeValues {
  reason?: string
}

export function RegradeModal({ exam, onClose, onDone, onStale }: RegradeModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const [form] = Form.useForm<RegradeValues>()
  // Whether a reason is typed — followed from onValuesChange (synchronous; Form.useWatch would report a task late).
  const [typed, setTyped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { requestClose } = useUnsavedChangesGuard(typed, onClose, 'examAttempts.regrade.unsaved')

  const submit = async (values: RegradeValues) => {
    setBusy(true)
    setError(null)
    try {
      const summary = await regradeExam(exam.id, (values.reason ?? '').trim())
      onDone(summary)
    } catch (caught) {
      const failure = describeAttemptsFailure(caught)
      const text = failureMessage(t, failure)
      if (isStaleExamFailure(failure)) {
        message.error(text)
        onStale()
        onClose()
        return
      }
      setBusy(false)
      setError(text)
    }
  }

  return (
    <Modal
      open
      title={t('examAttempts.regrade.title', { name: localizedLabel(exam.title, language) })}
      okText={t('examAttempts.regrade.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={busy}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!busy) requestClose()
      }}
      // A typed reason turns off the Escape key and the mask click.
      keyboard={!typed}
      mask={{ closable: !typed }}
      destroyOnHidden
    >
      <Typography.Paragraph>{t('examAttempts.regrade.what')}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('examAttempts.regrade.usual')}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{t('examAttempts.regrade.stale')}</Typography.Paragraph>
      <Form<RegradeValues>
        form={form}
        name="exam-regrade"
        layout="vertical"
        disabled={busy}
        onValuesChange={(_changed, values) => setTyped((values.reason ?? '').trim() !== '')}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="reason"
          label={t('examAttempts.regrade.reason')}
          // The field's «n / 500» counter sits at the end of the hint's first line: the hint keeps clear of that corner,
          // or at 390 px its wrapped text runs under the counter (KI-091 — the fix of users/ReasonHint.tsx).
          extra={<span style={{ display: 'block', paddingInlineEnd: 72 }}>{t('examAttempts.regrade.reasonHint', { max: CORRECTION_REASON_MAX_LENGTH })}</span>}
          rules={[
            { required: true, whitespace: true, message: t('examAttempts.regrade.reasonRequired') },
            { max: CORRECTION_REASON_MAX_LENGTH, message: t('examAttempts.regrade.reasonTooLong', { max: CORRECTION_REASON_MAX_LENGTH }) },
          ]}
        >
          <Input.TextArea rows={3} maxLength={CORRECTION_REASON_MAX_LENGTH} showCount autoFocus />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Modal>
  )
}
