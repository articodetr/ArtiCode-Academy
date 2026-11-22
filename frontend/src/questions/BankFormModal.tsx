// Create / edit one question bank (MOD-09 phase 2 — OEX-T07): API-261 for a new
// bank, API-263 with the smallest PATCH for an existing one (no request when
// nothing changed). The form holds the name (Arabic required, English
// optional), the description and the course the bank is filed under; a
// Turkish text the form does not show is kept. `course_not_found` — a course
// the caller may not file a bank under — is shown on the course field, any
// other refusal above the form. While the form holds unsaved work, Escape and
// a mask click do nothing, × and «cancel» ask first, a browser back/forward
// asks the same question and a reload or a tab close gets the browser's own
// prompt (useUnsavedChangesGuard, in the dialog's own words). The parent
// mounts it per session (KI-049: a form instance kept across sessions would
// bring back an earlier bank's values).
import { Alert, App, Col, Form, Input, Modal, Row, Select } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BANK_NAME_MAX_LENGTH, QUESTION_TEXT_MAX_LENGTH, createQuestionBank, updateQuestionBank } from '../api/questionBanks'
import type { QuestionBank } from '../api/questionBanks'
import { useAuth } from '../auth/auth-context'
import { NavigationBlocker } from '../common/NavigationBlocker'
import { useUnsavedChangesGuard } from '../common/useUnsavedChangesGuard'
import { useLocalized } from '../i18n/useLocalized'
import { localizedLabel } from '../users/users.format'
import { BankCoursePicker } from './BankCoursePicker'
import { bankFormHasChanges, bankFormValuesOf, buildCreateBankInput, newBankForm, planBankPatch } from './questionBanks.form'
import type { BankFormValues } from './questionBanks.form'
import { describeQuestionsFailure, failureMessage, isQuestionsFailure } from './questions.errors'

interface BankFormModalProps {
  /** The bank to edit; null creates a new one. */
  bank: QuestionBank | null
  onClose: () => void
  /** The bank as the server returned it; `created` tells a new bank from an edit. */
  onSaved: (bank: QuestionBank, created: boolean) => void
  /** The bank is gone (404): the page re-reads its list. */
  onStale: () => void
}

export function BankFormModal({ bank, onClose, onSaved, onStale }: BankFormModalProps) {
  const { t } = useTranslation()
  const { language } = useLocalized()
  const { message } = App.useApp()
  const { hasPermission } = useAuth()
  // GET /api/courses needs courses.read: without it the course of the bank stays as it is.
  const canPickCourse = hasPermission('courses.read')
  // With classes.manage a bank is filed under any course; otherwise under one the caller teaches a class of (D-R162).
  const filesUnderAnyCourse = hasPermission('classes.manage')
  // Untyped so setFields accepts the string[] name paths of the error mapper.
  const [form] = Form.useForm()
  const [initialValues] = useState<BankFormValues>(() => (bank ? bankFormValuesOf(bank) : newBankForm()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsaved, setUnsaved] = useState(false)

  const close = () => {
    setUnsaved(false)
    onClose()
  }

  const { requestClose, holdNavigation } = useUnsavedChangesGuard(unsaved, close, 'questionBanks.bankForm.unsaved')

  const submit = async (values: BankFormValues) => {
    setError(null)
    const patch = bank ? planBankPatch(bank, values) : null
    if (bank && !patch) {
      message.info(t('questionBanks.banks.nothingChanged'))
      close()
      return
    }
    setSaving(true)
    try {
      const saved = bank && patch ? await updateQuestionBank(bank.id, patch) : await createQuestionBank(buildCreateBankInput(values))
      // Saved: nothing is left to lose, even before the page closes the dialog.
      setUnsaved(false)
      onSaved(saved, bank === null)
    } catch (caught) {
      const failure = describeQuestionsFailure(caught)
      const text = failureMessage(t, failure)
      if (failure.field) form.setFields([{ name: failure.field, errors: [text] }])
      else setError(text)
      if (isQuestionsFailure(failure, 'question_bank_not_found')) onStale()
      setSaving(false)
    }
  }

  const maxLength = (max: number) => ({ max, message: t('questionBanks.bankForm.validation.maxLength', { max }) })

  /** An English text needs the Arabic one: the server requires `ar` in every localized object. */
  const arabicFirst = (arField: string) => ({
    validator: (_: unknown, value: string | undefined) =>
      !value?.trim() || (form.getFieldValue(arField) as string | undefined)?.trim() ? Promise.resolve() : Promise.reject(new Error(t('questionBanks.bankForm.validation.arabicFirst'))),
  })

  const courseHint = !canPickCourse ? 'needsCoursesRead' : filesUnderAnyCourse ? 'course' : 'courseTaught'

  return (
    <Modal
      open
      title={bank ? t('questionBanks.bankForm.editTitle', { name: localizedLabel(bank.name, language) }) : t('questionBanks.bankForm.createTitle')}
      okText={bank ? t('common.save') : t('questionBanks.bankForm.create')}
      cancelText={t('common.cancel')}
      onOk={() => form.submit()}
      onCancel={() => {
        if (!saving) requestClose()
      }}
      confirmLoading={saving}
      // Unsaved work turns off the Escape key and the mask click; × and «cancel» ask first.
      keyboard={!unsaved}
      mask={{ closable: !unsaved }}
      destroyOnHidden
      width={720}
    >
      <NavigationBlocker when={unsaved} onBlocked={holdNavigation} />
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Form
        form={form}
        name="question-bank-form"
        layout="vertical"
        requiredMark={false}
        initialValues={initialValues}
        onFinish={(values) => void submit(values as BankFormValues)}
        // Compared with the bank as loaded on every change, so a change changed back holds nothing.
        onValuesChange={(_changed, values) => setUnsaved(bankFormHasChanges(bank, values as BankFormValues))}
        disabled={saving}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('questionBanks.bankForm.fields.nameAr')}
              rules={[{ required: true, whitespace: true, message: t('questionBanks.bankForm.validation.nameArRequired') }, maxLength(BANK_NAME_MAX_LENGTH)]}
            >
              <Input maxLength={BANK_NAME_MAX_LENGTH} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('questionBanks.bankForm.fields.nameEn')} dependencies={['nameAr']} rules={[maxLength(BANK_NAME_MAX_LENGTH), arabicFirst('nameAr')]}>
              <Input dir="ltr" maxLength={BANK_NAME_MAX_LENGTH} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="descriptionAr" label={t('questionBanks.bankForm.fields.descriptionAr')} rules={[maxLength(QUESTION_TEXT_MAX_LENGTH)]}>
              <Input.TextArea rows={3} maxLength={QUESTION_TEXT_MAX_LENGTH} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="descriptionEn"
              label={t('questionBanks.bankForm.fields.descriptionEn')}
              dependencies={['descriptionAr']}
              rules={[maxLength(QUESTION_TEXT_MAX_LENGTH), arabicFirst('descriptionAr')]}
            >
              <Input.TextArea rows={3} dir="ltr" maxLength={QUESTION_TEXT_MAX_LENGTH} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="courseId" label={t('questionBanks.bankForm.fields.course')} extra={t(`questionBanks.bankForm.hints.${courseHint}`)}>
          {canPickCourse ? (
            <BankCoursePicker allowClear initial={bank?.course ?? null} placeholder={t('questionBanks.bankForm.coursePlaceholder')} style={{ maxWidth: 480 }} />
          ) : (
            // The course cannot be listed: it stays as it is, named when the bank has one.
            <Select<string>
              disabled
              placeholder={t('questionBanks.banks.noCourse')}
              options={bank?.course ? [{ value: bank.course.id, label: `${bank.course.code} — ${localizedLabel(bank.course.name, language)}` }] : []}
              style={{ maxWidth: 480 }}
            />
          )}
        </Form.Item>
      </Form>
    </Modal>
  )
}
